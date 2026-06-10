// AWIP Core contract API.
// Routes:
//   GET  /capabilities                     -> list capabilities
//   POST /capabilities/register            -> register a capability (stub for module projects)
//   POST /okr/ingest                       -> ingest a draft OKR tree (idempotent)
//   POST /okr/:id/spawn                    -> spawn a sub-OKR
//   POST /okr/:id/supersede                -> supersede an OKR with a new node
//   GET  /okr/tree?tenant_id=...           -> fetch full tree (incl. superseded)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { scanLesson, describeIssues } from "./lessonSafety.ts";
import { withLogger } from "../_shared/logger.ts";
import { logAiCall } from "../_shared/ai-usage.ts";
import { pickModel } from "../_shared/model-policy.ts";
import {
  evaluateCapability,
  refineConnectorsGate,
  type CapabilityRow,
  type CapabilityPromotionStatus,
} from "./promotion_gates.ts";
import {
  buildReport as buildPromotionAuditReport,
  type ObservationRow as PaObservationRow,
  type ProposalRow as PaProposalRow,
  type ShiftRow as PaShiftRow,
} from "./promotion_audit.ts";
import { validateRegisterInput } from "../_shared/contracts/module-register.ts";
import { validateHeartbeatInput } from "../_shared/contracts/module-heartbeat.ts";
import {
  ResolverThresholdsPutSchema,
  type ResolverThresholdRow,
} from "../_shared/contracts/resolver-thresholds.ts";
import {
  CORE_DEFAULT_TOKENS,
  SPEC_VERSION as DESIGN_SYSTEM_SPEC_VERSION,
  type TokensResponse,
} from "../_shared/contracts/design-system-tokens.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-awip-service-token, x-copilot-agent",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

// ---------- redaction ----------
// Scrub secrets from anything we persist (api_call_logs, *_events.payload).
// Defensive: walk strings, leave non-strings alone, cap recursion depth.
const SERVICE_TOKEN_VALUE = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";

// ---------- approval callback SSRF guard ----------
// Approval callbacks fire to caller-supplied URLs. To prevent token
// exfiltration we (1) require https, (2) allowlist hostnames via
// APPROVAL_CALLBACK_ALLOWED_HOSTS (comma-separated; supports leading "."
// suffix matches), and (3) NEVER forward the global AWIP service token —
// instead we sign the body with APPROVAL_CALLBACK_SECRET (if set) so the
// receiver can verify authenticity without holding the master token.
const APPROVAL_CALLBACK_ALLOWED_HOSTS = (Deno.env.get("APPROVAL_CALLBACK_ALLOWED_HOSTS") ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const APPROVAL_CALLBACK_SECRET = Deno.env.get("APPROVAL_CALLBACK_SECRET") ?? "";

export function isCallbackUrlAllowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  // Block obvious internal/loopback targets even if allowlist is empty.
  if (host === "localhost" || host.endsWith(".local") ||
      host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)) return false;
  if (APPROVAL_CALLBACK_ALLOWED_HOSTS.length === 0) return false;
  return APPROVAL_CALLBACK_ALLOWED_HOSTS.some((allowed) =>
    allowed.startsWith(".") ? host.endsWith(allowed) || host === allowed.slice(1) : host === allowed,
  );
}

async function signCallbackBody(body: string): Promise<string | null> {
  if (!APPROVAL_CALLBACK_SECRET) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APPROVAL_CALLBACK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const REDACTION_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
];
function redactString(s: string): string {
  let out = s;
  for (const re of REDACTION_PATTERNS) out = out.replace(re, "[REDACTED]");
  if (SERVICE_TOKEN_VALUE && out.includes(SERVICE_TOKEN_VALUE)) {
    out = out.split(SERVICE_TOKEN_VALUE).join("[REDACTED]");
  }
  return out;
}
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Auth: operator JWT, legacy global service token, OR a per-module hashed token.
// Per-module tokens carry an owning_module scope that gates writes against payload.owning_module.
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string compare to prevent timing attacks on token equality.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorize(req: Request): Promise<{ ok: boolean; actor: string; user_id?: string; owning_module?: string | null; via?: "service" | "module" | "jwt"; error?: string }> {
  const serviceToken = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-awip-service-token");
  if (provided) {
    // 1) Legacy global token (Discovery AI + cron). Unscoped.
    if (serviceToken && timingSafeEqual(provided, serviceToken)) {
      return { ok: true, actor: "service:discovery_ai", owning_module: null, via: "service" };
    }
    // 2) Per-module hashed token lookup.
    try {
      const hash = await sha256Hex(provided);
      const { data } = await supabase.rpc("resolve_module_token", { _hash: hash });
      const row = Array.isArray(data) && data.length > 0 ? data[0] as { owning_module: string; label: string; token_id: string } : null;
      if (row) {
        // best-effort last-used touch (don't block)
        supabase.from("module_service_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.token_id).then(() => {}, () => {});
        return { ok: true, actor: `module:${row.owning_module}:${row.label}`, owning_module: row.owning_module, via: "module" };
      }
    } catch (_e) { /* fall through */ }
    return { ok: false, actor: "", error: "invalid service token" };
  }
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, actor: "", error: "missing auth" };
  const jwt = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return { ok: false, actor: "", error: "invalid jwt" };
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  const isOp = roles?.some((r) => r.role === "operator" || r.role === "admin");
  if (!isOp) return { ok: false, actor: "", error: "not operator" };
  return { ok: true, actor: `user:${data.user.id}`, user_id: data.user.id, owning_module: null, via: "jwt" };
}


// ---------- agent scope enforcement ----------
const RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

type Scope = {
  agent_id: string | null;
  agent_slug: string | null;
  capability_ids: string[];   // empty => unrestricted
  tables: string[];           // empty => unrestricted
  max_risk: "low" | "medium" | "high";
  source: string;
};

type CopilotAgentRow = {
  id: string;
  slug: string;
  allowed_capability_ids: string[] | null;
  allowed_tables: string[] | null;
  max_risk: "low" | "medium" | "high" | null;
  enabled: boolean;
};

async function resolveActiveScope(req: Request, userId?: string): Promise<Scope | null> {
  // 1) Header override (e.g., service calls) — slug from x-copilot-agent
  const headerSlug = req.headers.get("x-copilot-agent");
  let agentRow: CopilotAgentRow | null = null;
  if (headerSlug) {
    const { data } = await supabase.from("copilot_agents")
      .select("id, slug, allowed_capability_ids, allowed_tables, max_risk, enabled")
      .eq("slug", headerSlug).maybeSingle();
    if (data?.enabled) agentRow = data as CopilotAgentRow;
  }
  // 2) Per-user active agent
  if (!agentRow && userId) {
    const { data: settings } = await supabase.from("copilot_settings")
      .select("active_agent_id").eq("user_id", userId).maybeSingle();
    if (settings?.active_agent_id) {
      const { data } = await supabase.from("copilot_agents")
        .select("id, slug, allowed_capability_ids, allowed_tables, max_risk, enabled")
        .eq("id", settings.active_agent_id).maybeSingle();
      if (data?.enabled) agentRow = data as CopilotAgentRow;
    }
  }
  if (!agentRow) return null; // no active agent => no scope enforcement

  // 3) Intersect with the user's profile narrowing
  let narrowedCaps: string[] = [];
  let narrowedTables: string[] = [];
  let narrowedRisk: "low" | "medium" | "high" = "high";
  if (userId) {
    const { data: prof } = await supabase.from("copilot_profiles")
      .select("narrowed_capability_ids, narrowed_tables, narrowed_max_risk")
      .eq("user_id", userId).maybeSingle();
    if (prof) {
      narrowedCaps = prof.narrowed_capability_ids ?? [];
      narrowedTables = prof.narrowed_tables ?? [];
      narrowedRisk = (prof.narrowed_max_risk ?? "high") as "low" | "medium" | "high";
    }
  }
  const intersect = (a: string[], b: string[]) =>
    a.length === 0 ? b : b.length === 0 ? a : a.filter((x) => b.includes(x));
  const minRisk = (a: string, b: string): "low" | "medium" | "high" =>
    (RISK_RANK[a] <= RISK_RANK[b] ? a : b) as "low" | "medium" | "high";

  return {
    agent_id: agentRow.id,
    agent_slug: agentRow.slug,
    capability_ids: intersect(agentRow.allowed_capability_ids ?? [], narrowedCaps),
    tables: intersect(agentRow.allowed_tables ?? [], narrowedTables),
    max_risk: minRisk(agentRow.max_risk ?? "high", narrowedRisk),
    source: headerSlug ? "header" : "session",
  };
}

type ScopeViolation = {
  code: "capability_out_of_scope" | "tables_out_of_scope" | "risk_exceeds_max";
  reason: string;
  detail: Record<string, unknown>;
  suggestion: { action: string; description: string; payload?: Record<string, unknown> };
};

function checkScope(scope: Scope, opts: {
  capability_id?: string | null;
  tables?: string[];
  risk?: "low" | "medium" | "high";
}): { ok: true } | { ok: false; violations: ScopeViolation[] } {
  const violations: ScopeViolation[] = [];

  if (opts.capability_id && scope.capability_ids.length > 0
      && !scope.capability_ids.includes(opts.capability_id)) {
    // Best-effort nearest match: same prefix before first ':' / '.' / '-'
    const sep = /[:.\-/]/;
    const prefix = opts.capability_id.split(sep)[0];
    const nearest = scope.capability_ids
      .filter((c) => c.startsWith(prefix + ".") || c.startsWith(prefix + ":") || c.startsWith(prefix + "-") || c === prefix)
      .slice(0, 5);
    violations.push({
      code: "capability_out_of_scope",
      reason: `Capability '${opts.capability_id}' is not in agent '${scope.agent_slug}' scope.`,
      detail: { requested: opts.capability_id, allowed_count: scope.capability_ids.length, nearest_in_scope: nearest },
      suggestion: nearest.length
        ? {
            action: "retry_with_capability",
            description: `Retry using a capability the agent can call (closest match: ${nearest[0]}).`,
            payload: { capability_id: nearest[0] },
          }
        : {
            action: "switch_agent_or_request_grant",
            description: `No similar capability in scope. Switch to an agent that owns '${opts.capability_id}' or ask an admin to add it to '${scope.agent_slug}.allowed_capability_ids'.`,
          },
    });
  }

  if (opts.tables && opts.tables.length && scope.tables.length > 0) {
    const bad = opts.tables.filter((t) => !scope.tables.includes(t));
    if (bad.length) {
      const allowedSubset = opts.tables.filter((t) => scope.tables.includes(t));
      violations.push({
        code: "tables_out_of_scope",
        reason: `Tables not in agent scope: ${bad.join(", ")}.`,
        detail: { requested: opts.tables, denied: bad, allowed_intersection: allowedSubset },
        suggestion: allowedSubset.length
          ? {
              action: "retry_with_subset",
              description: `Re-issue the call against only the allowed tables (${allowedSubset.join(", ")}); ${bad.join(", ")} would need a separate request from an agent that owns them.`,
              payload: { tables: allowedSubset },
            }
          : {
              action: "switch_agent_or_request_grant",
              description: `No requested table is in scope. Switch agents or ask an admin to add ${bad.join(", ")} to '${scope.agent_slug}.allowed_tables'.`,
            },
      });
    }
  }

  if (opts.risk && RISK_RANK[opts.risk] > RISK_RANK[scope.max_risk]) {
    violations.push({
      code: "risk_exceeds_max",
      reason: `Requested risk '${opts.risk}' exceeds agent max_risk '${scope.max_risk}'.`,
      detail: { requested_risk: opts.risk, max_risk: scope.max_risk, agent: scope.agent_slug },
      suggestion: {
        action: "queue_for_human_approval",
        description: `Lower the action's risk if possible, or submit it to /approvals/request as a 'pending' item so an operator can decide. Do not bypass.`,
        payload: { risk: scope.max_risk },
      },
    });
  }

  if (violations.length) return { ok: false, violations };
  return { ok: true };
}

async function logApiCall(entry: {
  route: string;
  method: string;
  actor: string | null;
  idempotency_key: string | null;
  idempotent_replay?: boolean;
  status_code: number;
  duration_ms: number;
  tenant_id?: string | null;
  request_summary?: Record<string, unknown>;
  response_summary?: Record<string, unknown>;
  error?: string | null;
}) {
  // Structured log line — surfaces in `supabase functions logs awip-api` and the platform log viewer.
  // One JSON object per call; severity reflects status. Slow calls (>1500ms) are tagged "slow".
  const SLOW_MS = 1500;
  const severity =
    entry.status_code >= 500 ? "error"
    : entry.status_code >= 400 && entry.status_code !== 401 ? "warn"
    : "info";
  const logLine = {
    ts: new Date().toISOString(),
    fn: "awip-api",
    severity,
    route: entry.route,
    method: entry.method,
    status: entry.status_code,
    duration_ms: entry.duration_ms,
    actor: entry.actor,
    tenant_id: entry.tenant_id ?? null,
    idempotency_key: entry.idempotency_key,
    idempotent_replay: entry.idempotent_replay ?? false,
    slow: entry.duration_ms >= SLOW_MS,
    error: entry.error ?? null,
  };
  if (severity === "error") console.error(JSON.stringify(logLine));
  else if (severity === "warn" || logLine.slow) console.warn(JSON.stringify(logLine));
  else console.log(JSON.stringify(logLine));

  try {
    await supabase.from("api_call_logs").insert({
      route: entry.route,
      method: entry.method,
      actor: entry.actor,
      idempotency_key: entry.idempotency_key,
      idempotent_replay: entry.idempotent_replay ?? false,
      status_code: entry.status_code,
      duration_ms: entry.duration_ms,
      tenant_id: entry.tenant_id ?? null,
      request_summary: redact(entry.request_summary ?? {}),
      response_summary: redact(entry.response_summary ?? {}),
      error: entry.error ? redact(entry.error) : null,
    });
  } catch (e) {
    console.error(JSON.stringify({ fn: "awip-api", severity: "error", msg: "logApiCall insert failed", error: String(e) }));
  }
}

// Idempotency-Key format: 1-200 chars, printable ASCII, no whitespace.
const IDEM_KEY_RE = /^[!-~]{1,200}$/;
function validateIdemKey(key: string | null): { ok: true } | { ok: false; error: string } {
  if (key === null) return { ok: true };
  if (!IDEM_KEY_RE.test(key)) {
    return { ok: false, error: "invalid idempotency-key (1-200 printable ASCII, no whitespace)" };
  }
  return { ok: true };
}

async function hashBody(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkIdempotency(scope: string, key: string | null) {
  if (!key) return null;
  const { data } = await supabase
    .from("idempotency_keys")
    .select("response")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();
  return data?.response ?? null;
}

// Returns { conflict: true } if the same key was used previously with a different body hash.
async function checkIdempotencyConflict(scope: string, key: string | null, bodyHash: string) {
  if (!key) return { conflict: false as const };
  const { data } = await supabase
    .from("idempotency_keys")
    .select("response")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();
  if (!data) return { conflict: false as const };
  const stored = (data.response as { __body_hash?: string } | null)?.__body_hash;
  if (stored && stored !== bodyHash) return { conflict: true as const };
  return { conflict: false as const, cached: data.response };
}

async function storeIdempotency(scope: string, key: string | null, tenantId: string | null, response: unknown, bodyHash?: string) {
  if (!key) return;
  const payload = bodyHash && response && typeof response === "object"
    ? { ...(response as object), __body_hash: bodyHash }
    : response;
  await supabase.from("idempotency_keys").insert({ scope, key, tenant_id: tenantId, response: payload });
}

// ---------- handlers ----------

async function listCapabilities(url: URL) {
  const status = url.searchParams.get("status");
  let q = supabase.from("capabilities").select("*").order("id");
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ capabilities: data });
}

// ---------- promotion (Phase-3 maturity) ----------

async function isAdminActor(userId?: string): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

async function loadPromotionInputs() {
  const [capsRes, eventsRes, approvalsRes, qaRes, measRes, connRes] = await Promise.all([
    supabase.from("capabilities").select("*").order("id"),
    supabase.from("capability_events")
      .select("capability_id, event_type, created_at, payload")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("approval_queue").select("id, status, capability_id").eq("status", "pending"),
    supabase.from("qa_checks").select("criterion, status, phase_key").eq("phase_key", "phase-3"),
    supabase.from("okr_measurements").select("required_capabilities"),
    supabase.from("capability_connectors").select("capability_id"),
  ]);
  if (capsRes.error) throw new Error(capsRes.error.message);
  const eventsByCap = new Map<string, any[]>();
  for (const e of (eventsRes.data ?? [])) {
    const arr = eventsByCap.get(e.capability_id as string) ?? [];
    arr.push(e);
    eventsByCap.set(e.capability_id as string, arr);
  }
  const connectorsByCap = new Map<string, number>();
  for (const c of (connRes.data ?? [])) {
    connectorsByCap.set(c.capability_id as string, (connectorsByCap.get(c.capability_id as string) ?? 0) + 1);
  }
  const okrSet = new Set<string>();
  for (const m of (measRes.data ?? [])) {
    for (const c of ((m.required_capabilities as string[] | null) ?? [])) okrSet.add(c);
  }
  return {
    capabilities: (capsRes.data ?? []) as CapabilityRow[],
    eventsByCap,
    approvals: (approvalsRes.data ?? []) as Array<{ id: string; status: string; capability_id: string | null }>,
    qaChecksPhase3: (qaRes.data ?? []) as Array<{ criterion: string; status: string; phase_key: string }>,
    okrSet,
    connectorsByCap,
  };
}

function evaluateOne(
  cap: CapabilityRow,
  events: any[],
  approvals: Array<{ id: string; status: string; capability_id: string | null }>,
  qaChecksPhase3: Array<{ criterion: string; status: string; phase_key: string }>,
  okrSet: Set<string>,
  connectorRowCount: number,
): CapabilityPromotionStatus {
  const status = evaluateCapability({
    capability: cap,
    events,
    approvals,
    qaChecksPhase3,
    okrRequiredCapabilityIds: okrSet,
  });
  refineConnectorsGate(status, cap, connectorRowCount);
  return status;
}

async function getPromotionStatus(userId?: string) {
  if (!(await isAdminActor(userId))) return json({ error: "admin role required" }, 403);
  const inputs = await loadPromotionInputs();
  const results = inputs.capabilities.map((cap) =>
    evaluateOne(
      cap,
      inputs.eventsByCap.get(cap.id) ?? [],
      inputs.approvals,
      inputs.qaChecksPhase3,
      inputs.okrSet,
      inputs.connectorsByCap.get(cap.id) ?? 0,
    ),
  );
  const summary = {
    total: results.length,
    promotable: results.filter((r) => r.summary.promotable && r.capability.status !== "available" && r.capability.status !== "deprecated").length,
    blocked: results.filter((r) => !r.summary.promotable).length,
    already_available: results.filter((r) => r.capability.status === "available").length,
  };
  return json({ summary, capabilities: results });
}

async function getPromotionStatusOne(capId: string, userId?: string) {
  if (!(await isAdminActor(userId))) return json({ error: "admin role required" }, 403);
  const { data: cap, error } = await supabase.from("capabilities").select("*").eq("id", capId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!cap) return json({ error: "capability not found" }, 404);

  const [eventsRes, approvalsRes, qaRes, measRes, connRes] = await Promise.all([
    supabase.from("capability_events")
      .select("event_type, created_at, payload")
      .eq("capability_id", capId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("approval_queue").select("id, status, capability_id").eq("capability_id", capId).eq("status", "pending"),
    supabase.from("qa_checks").select("criterion, status, phase_key").eq("phase_key", "phase-3"),
    supabase.from("okr_measurements").select("required_capabilities"),
    supabase.from("capability_connectors").select("id").eq("capability_id", capId),
  ]);
  const okrSet = new Set<string>();
  for (const m of (measRes.data ?? [])) {
    for (const c of ((m.required_capabilities as string[] | null) ?? [])) okrSet.add(c);
  }
  const status = evaluateOne(
    cap as CapabilityRow,
    eventsRes.data ?? [],
    (approvalsRes.data ?? []) as Array<{ id: string; status: string; capability_id: string | null }>,
    qaRes.data ?? [],
    okrSet,
    (connRes.data ?? []).length,
  );
  return json(status);
}

// ---------- Night Agent promotion audit report ----------
// Admin-only. Returns the before/after snapshot for a single proposal,
// or for every decided/pending proposal in a shift.
async function getPromotionAudit(url: URL, userId?: string) {
  if (!(await isAdminActor(userId))) return json({ error: "admin role required" }, 403);
  const proposalId = url.searchParams.get("proposal_id");
  const shiftId = url.searchParams.get("shift_id");
  if (!proposalId && !shiftId) {
    return json({ error: "proposal_id or shift_id required" }, 400);
  }

  let proposals: PaProposalRow[] = [];
  if (proposalId) {
    const { data, error } = await supabase
      .from("night_proposals")
      .select("id, shift_id, status, kind, rationale, target_ref, payload, created_at, decided_at, decided_by")
      .eq("id", proposalId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "proposal not found" }, 404);
    proposals = [data as unknown as PaProposalRow];
  } else if (shiftId) {
    const { data, error } = await supabase
      .from("night_proposals")
      .select("id, shift_id, status, kind, rationale, target_ref, payload, created_at, decided_at, decided_by")
      .eq("shift_id", shiftId)
      .order("created_at", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    proposals = (data ?? []) as unknown as PaProposalRow[];
    if (proposals.length === 0) return json({ reports: [] });
  }

  const shiftIds = Array.from(new Set(proposals.map((p) => p.shift_id)));
  const [{ data: shifts, error: shErr }, { data: obs, error: obErr }] = await Promise.all([
    supabase
      .from("night_shifts")
      .select("id, started_at, ended_at, status, window_start, window_end, summary")
      .in("id", shiftIds),
    supabase
      .from("night_observations")
      .select("id, shift_id, kind, severity, summary, subject_ref, payload, created_at")
      .in("shift_id", shiftIds)
      .order("created_at", { ascending: true }),
  ]);
  if (shErr) return json({ error: shErr.message }, 500);
  if (obErr) return json({ error: obErr.message }, 500);

  const shiftById = new Map<string, PaShiftRow>();
  for (const s of (shifts ?? []) as unknown as PaShiftRow[]) shiftById.set(s.id, s);
  const obsByShift = new Map<string, PaObservationRow[]>();
  for (const o of (obs ?? []) as unknown as PaObservationRow[]) {
    const arr = obsByShift.get(o.shift_id) ?? [];
    arr.push(o);
    obsByShift.set(o.shift_id, arr);
  }

  const reports = proposals
    .map((p) => {
      const shift = shiftById.get(p.shift_id);
      if (!shift) return null;
      return buildPromotionAuditReport(p, shift, obsByShift.get(p.shift_id) ?? []);
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (proposalId) {
    if (reports.length === 0) return json({ error: "shift not found for proposal" }, 404);
    return json(reports[0]);
  }
  return json({ reports });
}

async function promoteCapability(req: Request, capId: string, actor: string, userId?: string) {
  if (!(await isAdminActor(userId))) return json({ error: "admin role required" }, 403);
  const idemKey = req.headers.get("idempotency-key");
  const cached = await checkIdempotency("capability_promote", idemKey);
  if (cached) return json(cached);

  const body = await req.text().then((t) => (t ? JSON.parse(t) : {})).catch(() => ({}));
  const ackRationale: string | null = body?.ack_rationale ?? null;

  const evalResp = await getPromotionStatusOne(capId, userId);
  if (evalResp.status !== 200) return evalResp;
  const status = await evalResp.clone().json() as CapabilityPromotionStatus;

  if (!status.summary.promotable) {
    return json({ error: "capability has failing gates", gates: status.gates }, 409);
  }
  if (status.summary.ack_required && !ackRationale) {
    return json({ error: "warnings present; ack_rationale required", gates: status.gates }, 409);
  }

  const { error: upErr } = await supabase
    .from("capabilities")
    .update({ status: "available", updated_at: new Date().toISOString() })
    .eq("id", capId);
  if (upErr) return json({ error: upErr.message }, 500);

  await supabase.from("capability_events").insert({
    capability_id: capId,
    event_type: "promoted_to_available",
    actor,
    payload: redact({ gates: status.gates, ack_rationale: ackRationale }),
  });

  const result = { ok: true, id: capId, status: "available", ack_rationale: ackRationale };
  await storeIdempotency("capability_promote", idemKey, null, result);
  return json(result);
}

async function ackCapabilityWarnings(req: Request, capId: string, actor: string, userId?: string) {
  if (!(await isAdminActor(userId))) return json({ error: "admin role required" }, 403);
  const idemKey = req.headers.get("idempotency-key");
  const cached = await checkIdempotency("capability_ack_warnings", idemKey);
  if (cached) return json(cached);

  const body = await req.text().then((t) => (t ? JSON.parse(t) : {})).catch(() => ({}));
  const rationale: string | null = body?.rationale ?? null;
  const gateKeys: string[] = Array.isArray(body?.gate_keys) ? body.gate_keys : [];
  if (!rationale?.trim()) return json({ error: "rationale required" }, 400);

  const { data: cap } = await supabase.from("capabilities").select("id").eq("id", capId).maybeSingle();
  if (!cap) return json({ error: "capability not found" }, 404);

  await supabase.from("capability_events").insert({
    capability_id: capId,
    event_type: "warnings_acknowledged",
    actor,
    payload: redact({ gate_keys: gateKeys, rationale }),
  });

  const result = { ok: true, id: capId, gate_keys: gateKeys };
  await storeIdempotency("capability_ack_warnings", idemKey, null, result);
  return json(result);
}

async function registerCapability(req: Request, actor: string, tokenScope: string | null | undefined) {
  const idemKey = req.headers.get("idempotency-key");
  const raw = await req.text();
  if (raw.length === 0) return json({ error: "empty body" }, 400);
  let bodyJson: unknown;
  try { bodyJson = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  const parsed = validateRegisterInput(bodyJson);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const body = parsed.value;

  // Scope check: per-module token may only write its own module. Legacy global token (tokenScope=null) is unrestricted.
  if (tokenScope && tokenScope !== body.owning_module) {
    return json({ error: `token scope '${tokenScope}' cannot register for '${body.owning_module}'` }, 403);
  }

  // Idempotency on header OR body.idempotency_key (header wins).
  const effectiveKey = idemKey ?? (body.idempotency_key || null);
  const bodyHash = await hashBody(raw);
  if (effectiveKey) {
    const conflict = await checkIdempotencyConflict("capability_register", effectiveKey, bodyHash);
    if (conflict.conflict) return json({ error: "idempotency-key already used with a different body" }, 409);
    if (conflict.cached) {
      const { __body_hash, ...rest } = conflict.cached as Record<string, unknown>;
      return json({ ...rest, idempotent_replay: true });
    }
  }

  // Snapshot current row (if any) to diff for event types.
  const { data: prev } = await supabase
    .from("capabilities")
    .select("id,status,version,owning_module")
    .eq("id", body.id)
    .maybeSingle();

  const { error: upErr } = await supabase.from("capabilities").upsert({
    id: body.id,
    name: body.name,
    description: body.description ?? null,
    status: body.status,
    version: body.version,
    inputs_required: body.inputs_required ?? [],
    outputs_provided: body.outputs_provided ?? [],
    owning_module: body.owning_module,
    updated_at: new Date().toISOString(),
  });
  if (upErr) return json({ error: upErr.message }, 500);

  // Emit one event per dimension that actually changed, plus the existing 'registered' on first sight.
  const events: Array<Record<string, unknown>> = [];
  if (!prev) {
    events.push({ capability_id: body.id, event_type: "registered", actor, payload: redact(body) });
  } else {
    if (prev.status !== body.status) {
      events.push({
        capability_id: body.id, event_type: "status_changed", actor,
        payload: redact({ from: prev.status, to: body.status, source: "register" }),
      });
      if (body.status === "deprecated") {
        events.push({ capability_id: body.id, event_type: "deprecated", actor, payload: redact({ from: prev.status }) });
      }
    }
    if (prev.version !== body.version) {
      events.push({
        capability_id: body.id, event_type: "version_bumped", actor,
        payload: redact({ from: prev.version, to: body.version }),
      });
    }
    if ((prev.owning_module ?? null) !== body.owning_module) {
      events.push({
        capability_id: body.id, event_type: "owning_module_changed", actor,
        payload: redact({ from: prev.owning_module, to: body.owning_module }),
      });
    }
  }
  if (events.length > 0) {
    await supabase.from("capability_events").insert(events);
  }

  const result = { ok: true, id: body.id, events_emitted: events.map((e) => e.event_type) };
  if (effectiveKey) await storeIdempotency("capability_register", effectiveKey, null, result, bodyHash);
  return json(result);
}

async function moduleHeartbeat(req: Request, actor: string, tokenScope: string | null | undefined) {
  const raw = await req.text();
  if (raw.length === 0) return json({ error: "empty body" }, 400);
  let bodyJson: unknown;
  try { bodyJson = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  const parsed = validateHeartbeatInput(bodyJson);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const body = parsed.value;

  if (tokenScope && tokenScope !== body.owning_module) {
    return json({ error: `token scope '${tokenScope}' cannot heartbeat for '${body.owning_module}'` }, 403);
  }

  const { data, error } = await supabase
    .from("module_heartbeats")
    .insert({
      owning_module: body.owning_module,
      version: body.version ?? null,
      capability_ids: body.capability_ids ?? [],
      sender: actor,
      payload: redact(body.payload ?? {}),
    })
    .select("id, created_at")
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id: data.id, created_at: data.created_at });
}


async function ingestOkrTree(req: Request, actor: string) {
  const idemKey = req.headers.get("idempotency-key");
  const raw = await req.text();
  if (raw.length === 0) return json({ error: "empty body" }, 400);
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  const bodyHash = await hashBody(raw);
  const conflict = await checkIdempotencyConflict("okr_ingest", idemKey, bodyHash);
  if (conflict.conflict) return json({ error: "idempotency-key already used with a different body" }, 409);
  if (conflict.cached) {
    const { __body_hash: _h, ...rest } = conflict.cached as Record<string, unknown>;
    return json(rest);
  }

  const { tenant_slug, tenant_name, nodes } = body as {
    tenant_slug: string;
    tenant_name?: string;
    nodes: Array<{
      client_id: string; // caller-assigned ref so we can wire parent_id
      parent_client_id?: string | null;
      kind: "objective" | "key_result";
      title: string;
      description?: string;
      measurement?: {
        metric_name: string;
        baseline?: number;
        target?: number;
        unit?: string;
        cadence?: string;
        attribution_rules?: Record<string, unknown>;
        data_sources?: unknown[];
        required_capabilities?: string[];
      };
    }>;
  };

  if (!tenant_slug || !Array.isArray(nodes) || nodes.length === 0) {
    return json({ error: "tenant_slug and nodes required" }, 400);
  }

  // tenant upsert
  let { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("slug", tenant_slug)
    .maybeSingle();
  if (!tenant) {
    const ins = await supabase
      .from("tenants")
      .insert({ slug: tenant_slug, name: tenant_name ?? tenant_slug })
      .select()
      .single();
    if (ins.error) return json({ error: ins.error.message }, 500);
    tenant = ins.data;
  }

  // capability validation
  const allReq = new Set<string>();
  for (const n of nodes) {
    n.measurement?.required_capabilities?.forEach((c) => allReq.add(c));
  }
  const warnings: string[] = [];
  if (allReq.size > 0) {
    const { data: caps } = await supabase
      .from("capabilities")
      .select("id,status")
      .in("id", [...allReq]);
    const known = new Map(caps?.map((c) => [c.id, c.status]) ?? []);
    for (const c of allReq) {
      if (!known.has(c)) warnings.push(`unknown capability: ${c}`);
      else if (known.get(c) !== "available") warnings.push(`capability ${c} is ${known.get(c)} (future hook)`);
    }
  }

  // insert nodes in order, mapping client_id -> real id
  const idMap = new Map<string, string>();
  const created: Array<{ client_id: string; id: string }> = [];
  // Sort: objectives first, then KRs; within each, parent before child by simple BFS of client_ids
  const ordered = [...nodes].sort((a, b) => {
    if (!a.parent_client_id && b.parent_client_id) return -1;
    if (a.parent_client_id && !b.parent_client_id) return 1;
    return 0;
  });

  for (const n of ordered) {
    const parent_id = n.parent_client_id ? idMap.get(n.parent_client_id) ?? null : null;
    const ins = await supabase
      .from("okr_nodes")
      .insert({
        tenant_id: tenant!.id,
        parent_id,
        kind: n.kind,
        title: n.title,
        description: n.description ?? null,
        status: "draft",
        created_by: "discovery_ai",
      })
      .select()
      .single();
    if (ins.error) return json({ error: ins.error.message }, 500);
    idMap.set(n.client_id, ins.data.id);
    created.push({ client_id: n.client_id, id: ins.data.id });

    if (n.kind === "key_result" && n.measurement) {
      const m = n.measurement;
      await supabase.from("okr_measurements").insert({
        okr_node_id: ins.data.id,
        metric_name: m.metric_name,
        baseline: m.baseline ?? null,
        target: m.target ?? null,
        unit: m.unit ?? null,
        cadence: m.cadence ?? null,
        attribution_rules: m.attribution_rules ?? {},
        data_sources: m.data_sources ?? [],
        required_capabilities: m.required_capabilities ?? [],
      });
    }

    await supabase.from("okr_node_events").insert({
      tenant_id: tenant!.id,
      okr_node_id: ins.data.id,
      event_type: "ingested",
      payload: redact({ client_id: n.client_id }),
      actor,
    });
  }

  const response = { ok: true, tenant_id: tenant!.id, created, warnings };
  await storeIdempotency("okr_ingest", idemKey, tenant!.id, response, bodyHash);
  return json(response);
}

async function spawnSubOkr(req: Request, parentId: string, actor: string) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.title || !body.kind || !body.spawned_from_reason) {
    return json({ error: "title, kind, spawned_from_reason required" }, 400);
  }
  const { data: parent, error: pErr } = await supabase
    .from("okr_nodes")
    .select("*")
    .eq("id", parentId)
    .single();
  if (pErr || !parent) return json({ error: "parent not found" }, 404);

  const ins = await supabase
    .from("okr_nodes")
    .insert({
      tenant_id: parent.tenant_id,
      parent_id: parent.id,
      kind: body.kind,
      title: body.title,
      description: body.description ?? null,
      status: "draft",
      spawned_from_reason: body.spawned_from_reason,
      created_by: body.created_by ?? "human",
    })
    .select()
    .single();
  if (ins.error) return json({ error: ins.error.message }, 500);

  await supabase.from("okr_node_events").insert({
    tenant_id: parent.tenant_id,
    okr_node_id: ins.data.id,
    event_type: "spawned",
    payload: redact({ parent_id: parent.id, reason: body.spawned_from_reason }),
    actor,
  });
  return json({ ok: true, node: ins.data });
}

async function supersedeOkr(req: Request, oldId: string, actor: string) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.title || !body.reason) return json({ error: "title and reason required" }, 400);
  const { data: old, error: oErr } = await supabase
    .from("okr_nodes")
    .select("*")
    .eq("id", oldId)
    .single();
  if (oErr || !old) return json({ error: "node not found" }, 404);

  const ins = await supabase
    .from("okr_nodes")
    .insert({
      tenant_id: old.tenant_id,
      parent_id: old.parent_id,
      kind: old.kind,
      title: body.title,
      description: body.description ?? old.description,
      status: "active",
      version: old.version + 1,
      spawned_from_reason: body.reason,
      created_by: body.created_by ?? "human",
    })
    .select()
    .single();
  if (ins.error) return json({ error: ins.error.message }, 500);

  await supabase
    .from("okr_nodes")
    .update({ status: "superseded", superseded_by: ins.data.id, updated_at: new Date().toISOString() })
    .eq("id", oldId);

  await supabase.from("okr_node_events").insert([
    {
      tenant_id: old.tenant_id,
      okr_node_id: oldId,
      event_type: "superseded",
      payload: redact({ superseded_by: ins.data.id, reason: body.reason }),
      actor,
    },
    {
      tenant_id: old.tenant_id,
      okr_node_id: ins.data.id,
      event_type: "created",
      payload: redact({ supersedes: oldId }),
      actor,
    },
  ]);

  return json({ ok: true, node: ins.data });
}

async function getTree(url: URL) {
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId) return json({ error: "tenant_id required" }, 400);
  const { data: nodes, error } = await supabase
    .from("okr_nodes")
    .select("*, okr_measurements(*)")
    .eq("tenant_id", tenantId)
    .order("created_at");
  if (error) return json({ error: error.message }, 500);
  return json({ nodes });
}

async function ingestEvents(req: Request, actor: string) {
  const idemKey = req.headers.get("idempotency-key");
  const raw = await req.text();
  if (raw.length === 0) return json({ error: "empty body" }, 400);
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  const bodyHash = await hashBody(raw);
  const conflict = await checkIdempotencyConflict("events_ingest", idemKey, bodyHash);
  if (conflict.conflict) return json({ error: "idempotency-key already used with a different body" }, 409);
  if (conflict.cached) {
    const { __body_hash: _h, ...rest } = conflict.cached as Record<string, unknown>;
    return json(rest);
  }

  const events = Array.isArray(body?.events) ? body.events : null;
  if (!events || events.length === 0) return json({ error: "events[] required" }, 400);

  const rows = (events as Array<Record<string, unknown>>).map((e) => ({
    capability_id: String(e.capability_id ?? ""),
    event_type: String(e.event_type ?? ""),
    payload: redact((e.payload as Record<string, unknown>) ?? {}),
    actor,
  }));
  if (rows.some((r) => !r.capability_id || !r.event_type)) {
    return json({ error: "each event needs capability_id and event_type" }, 400);
  }

  const { data, error } = await supabase.from("capability_events").insert(rows).select("id, created_at");
  if (error) return json({ error: error.message }, 500);
  const response = { ok: true, inserted: data?.length ?? 0, ids: (data ?? []).map((d) => d.id) };
  await storeIdempotency("events_ingest", idemKey, null, response, bodyHash);
  return json(response);
}

async function getRecentEvents(url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const since = url.searchParams.get("since"); // ISO timestamp
  const tenantId = url.searchParams.get("tenant_id");

  let oq = supabase.from("okr_node_events").select("*").order("created_at", { ascending: false }).limit(limit);
  let cq = supabase.from("capability_events").select("*").order("created_at", { ascending: false }).limit(limit);
  if (since) { oq = oq.gt("created_at", since); cq = cq.gt("created_at", since); }
  if (tenantId) oq = oq.eq("tenant_id", tenantId);

  const [o, c] = await Promise.all([oq, cq]);
  if (o.error) return json({ error: o.error.message }, 500);
  if (c.error) return json({ error: c.error.message }, 500);

  const merged = [
    ...(o.data ?? []).map((e) => ({
      id: e.id, source: "okr", ref: e.okr_node_id, tenant_id: e.tenant_id,
      event_type: e.event_type, payload: e.payload, actor: e.actor, created_at: e.created_at,
    })),
    ...(c.data ?? []).map((e) => ({
      id: e.id, source: "capability", ref: e.capability_id, tenant_id: null,
      event_type: e.event_type, payload: e.payload, actor: e.actor, created_at: e.created_at,
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);

  return json({ events: merged, count: merged.length });
}

async function getCapabilityDemand(actor: string) {
  const [capsRes, measRes, nodesRes, tenantsRes] = await Promise.all([
    supabase.from("capabilities").select("*"),
    supabase.from("okr_measurements").select("okr_node_id, required_capabilities"),
    supabase.from("okr_nodes").select("id, tenant_id, status"),
    supabase.from("tenants").select("id, slug, name"),
  ]);
  if (capsRes.error) return json({ error: capsRes.error.message }, 500);
  if (measRes.error) return json({ error: measRes.error.message }, 500);
  if (nodesRes.error) return json({ error: nodesRes.error.message }, 500);
  if (tenantsRes.error) return json({ error: tenantsRes.error.message }, 500);

  type NodeRow = { id: string; tenant_id: string; status: string };
  type MeasRow = { okr_node_id: string; required_capabilities: string[] | null };
  type CapRow = { id: string; name: string; status: string; owning_module: string | null };
  const nodeById = new Map((nodesRes.data ?? []).map((n) => [n.id, n as NodeRow]));
  type Agg = { tenants: Set<string>; krs: Set<string>; active_krs: Set<string> };
  const agg = new Map<string, Agg>();

  for (const m of (measRes.data ?? []) as MeasRow[]) {
    const node = nodeById.get(m.okr_node_id);
    if (!node) continue;
    for (const capId of (m.required_capabilities ?? []) as string[]) {
      let a = agg.get(capId);
      if (!a) { a = { tenants: new Set(), krs: new Set(), active_krs: new Set() }; agg.set(capId, a); }
      a.tenants.add(node.tenant_id);
      a.krs.add(m.okr_node_id);
      if (node.status !== "superseded") a.active_krs.add(m.okr_node_id);
    }
  }

  const rowFor = (c: CapRow, a?: Agg) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    owning_module: c.owning_module,
    tenant_ids: [...(a?.tenants ?? [])],
    tenant_count: a?.tenants.size ?? 0,
    kr_count: a?.krs.size ?? 0,
    active_kr_count: a?.active_krs.size ?? 0,
  });

  const demand = ((capsRes.data ?? []) as CapRow[]).map((c) => rowFor(c, agg.get(c.id)));

  for (const [capId, a] of agg) {
    if (!demand.find((d) => d.id === capId)) {
      demand.push(rowFor({ id: capId, name: capId, status: "unknown", owning_module: null }, a));
    }
  }

  demand.sort((a, b) =>
    b.active_kr_count - a.active_kr_count ||
    b.tenant_count - a.tenant_count ||
    a.name.localeCompare(b.name)
  );

  // Emit resolution_warning events for unowned/unknown capabilities with active demand.
  // De-dupe: skip ids that already have a resolution_warning in the last 10 minutes.
  try {
    const candidates = demand.filter(
      (d) =>
        d.active_kr_count > 0 &&
        (d.status === "unknown" || (!d.owning_module && d.status !== "unknown")),
    );
    if (candidates.length > 0) {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("capability_events")
        .select("capability_id")
        .eq("event_type", "resolution_warning")
        .in("capability_id", candidates.map((d) => d.id))
        .gt("created_at", tenMinAgo);
      const skip = new Set((recent ?? []).map((r) => r.capability_id));
      const toInsert = candidates
        .filter((d) => !skip.has(d.id))
        .map((d) => ({
          capability_id: d.id,
          event_type: "resolution_warning",
          actor,
          payload: redact({
            reason: d.status === "unknown" ? "unknown" : "unowned",
            tenant_count: d.tenant_count,
            active_kr_count: d.active_kr_count,
            tenant_ids: d.tenant_ids,
          }),
        }));
      if (toInsert.length > 0) {
        await supabase.from("capability_events").insert(toInsert);
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ fn: "awip-api", severity: "warn", msg: "resolution_warning emit failed", error: String(e) }));
  }

  return json({ demand, tenants: tenantsRes.data ?? [] });
}

async function getCapabilityDetail(capId: string) {
  const { data: cap } = await supabase.from("capabilities").select("*").eq("id", capId).maybeSingle();

  // Find measurements that reference this capability
  const { data: meas, error: mErr } = await supabase
    .from("okr_measurements")
    .select("okr_node_id, metric_name, target, unit, cadence, required_capabilities");
  if (mErr) return json({ error: mErr.message }, 500);
  const matching = (meas ?? []).filter((m) =>
    (m.required_capabilities ?? []).includes(capId)
  );
  const nodeIds = [...new Set(matching.map((m) => m.okr_node_id))];

  if (nodeIds.length === 0) {
    return json({
      capability: cap ?? { id: capId, name: capId, status: "unknown", owning_module: null },
      krs: [],
      tenants: [],
    });
  }

  const { data: nodes, error: nErr } = await supabase
    .from("okr_nodes")
    .select("id, tenant_id, parent_id, kind, title, status, version, created_at")
    .in("id", nodeIds);
  if (nErr) return json({ error: nErr.message }, 500);

  const tenantIds = [...new Set((nodes ?? []).map((n) => n.tenant_id))];
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, slug, name")
    .in("id", tenantIds);
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));

  const measByNode = new Map(matching.map((m) => [m.okr_node_id, m]));

  // Parent objective lookup
  const parentIds = [...new Set((nodes ?? []).map((n) => n.parent_id).filter(Boolean))];
  const { data: parents } = parentIds.length
    ? await supabase.from("okr_nodes").select("id, title").in("id", parentIds)
    : { data: [] as Array<{ id: string; title: string }> };
  const parentById = new Map((parents ?? []).map((p) => [p.id, p]));

  const krs = (nodes ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    status: n.status,
    version: n.version,
    created_at: n.created_at,
    tenant: tenantById.get(n.tenant_id) ?? null,
    parent_title: n.parent_id ? parentById.get(n.parent_id)?.title ?? null : null,
    measurement: measByNode.get(n.id) ?? null,
  }));

  // Tenants summary with KR counts
  const tenantSummary = tenantIds.map((tid) => {
    const tKrs = krs.filter((k) => k.tenant?.id === tid);
    return {
      ...(tenantById.get(tid) ?? { id: tid, slug: tid, name: tid }),
      kr_count: tKrs.length,
      active_kr_count: tKrs.filter((k) => k.status !== "superseded").length,
    };
  }).sort((a, b) => b.active_kr_count - a.active_kr_count);

  // Sort KRs: active first, then by created_at desc
  krs.sort((a, b) => {
    const as = a.status === "superseded" ? 1 : 0;
    const bs = b.status === "superseded" ? 1 : 0;
    if (as !== bs) return as - bs;
    return b.created_at.localeCompare(a.created_at);
  });

  return json({
    capability: cap ?? { id: capId, name: capId, status: "unknown", owning_module: null },
    krs,
    tenants: tenantSummary,
  });
}

// ---------- approvals ----------

async function requestApproval(req: Request, actor: string, userId?: string) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const required = ["capability_id", "activity", "requesting_module"];
  for (const k of required) if (!body[k]) return json({ error: `missing ${k}` }, 400);

  // Validate capability exists in registry
  const { data: cap } = await supabase
    .from("capabilities")
    .select("id")
    .eq("id", body.capability_id)
    .maybeSingle();
  if (!cap) return json({ error: `unknown capability_id: ${body.capability_id}` }, 400);

  // Idempotency: (requesting_module, idempotency_key) is unique
  if (body.idempotency_key) {
    const { data: existing } = await supabase
      .from("approval_queue")
      .select("id, status")
      .eq("requesting_module", body.requesting_module)
      .eq("idempotency_key", body.idempotency_key)
      .maybeSingle();
    if (existing) return json({ ok: true, approval_id: existing.id, status: existing.status, replayed: true });
  }

  const RISK_MAP: Record<string, string> = { low: "safe", medium: "risky", high: "blocker", safe: "safe", risky: "risky", blocker: "blocker", unknown: "unknown" };
  const risk = RISK_MAP[String(body.risk ?? "unknown")] ?? "unknown";

  // Reject SSRF-prone callback URLs before they ever land in the queue.
  if (body.callback_url && !isCallbackUrlAllowed(String(body.callback_url))) {
    return json({
      error: "callback_url_not_allowed",
      detail: "callback_url must be https and on APPROVAL_CALLBACK_ALLOWED_HOSTS",
    }, 400);
  }

  // ----- Agent scope enforcement -----
  // Resolves the caller's active Copilot agent (header override or session) intersected
  // with the user's profile narrowing, then checks capability/tables/risk.
  const scope = await resolveActiveScope(req, userId);
  if (scope) {
    const requestedRiskNorm: "low" | "medium" | "high" =
      risk === "safe" ? "low" : risk === "risky" ? "medium" : risk === "blocker" ? "high" : "high";
    const requestedTables: string[] = Array.isArray(body.intent_payload?.tables)
      ? body.intent_payload.tables.filter((t: unknown) => typeof t === "string")
      : [];
    const verdict = checkScope(scope, {
      capability_id: body.capability_id,
      tables: requestedTables,
      risk: requestedRiskNorm,
    });
    if (!verdict.ok) {
      const primary = verdict.violations[0];
      const summary = verdict.violations.map((v) => v.reason).join(" ");
      // Queue as auto-rejected so operators can audit / override.
      const { data: rej } = await supabase
        .from("approval_queue")
        .insert({
          activity: body.activity,
          risk,
          intent_payload: body.intent_payload ?? {},
          requested_by: body.requested_by ?? actor,
          tenant_id: body.tenant_id ?? null,
          requesting_module: body.requesting_module,
          capability_id: body.capability_id,
          callback_url: body.callback_url ?? null,
          idempotency_key: body.idempotency_key ?? null,
          status: "rejected",
          decided_by: "system:agent_scope",
          decided_at: new Date().toISOString(),
          result: {
            reason: "agent_scope",
            agent: scope.agent_slug,
            summary,
            violations: verdict.violations,
            suggestions: verdict.violations.map((v) => v.suggestion),
          },
        })
        .select("id, status")
        .single();
      await supabase.from("capability_events").insert({
        capability_id: body.capability_id,
        event_type: "approval_rejected_scope",
        actor,
        payload: redact({
          approval_id: rej?.id,
          activity: body.activity,
          risk,
          requesting_module: body.requesting_module,
          agent: scope.agent_slug,
          violations: verdict.violations,
        }),
      });
      return json({
        ok: false,
        error: "agent_scope_violation",
        agent: scope.agent_slug,
        approval_id: rej?.id ?? null,
        status: "rejected",
        // Structured payload the agent should surface to the user verbatim.
        primary_reason: primary.reason,
        violations: verdict.violations,
        suggestions: verdict.violations.map((v) => v.suggestion),
        next_steps: [
          "Read 'violations[].reason' for the exact rule that fired.",
          "Apply 'suggestions[0]' if it is a 'retry_with_*' action — it is the safest in-scope alternative.",
          "If suggestion is 'switch_agent_or_request_grant', surface it to the operator instead of retrying.",
          "If suggestion is 'queue_for_human_approval', re-submit through /approvals/request and wait for a decision.",
        ],
      }, 403);
    }
  }

  const { data: ins, error } = await supabase
    .from("approval_queue")
    .insert({
      activity: body.activity,
      risk,
      intent_payload: body.intent_payload ?? {},
      requested_by: body.requested_by ?? actor,
      tenant_id: body.tenant_id ?? null,
      requesting_module: body.requesting_module,
      capability_id: body.capability_id,
      callback_url: body.callback_url ?? null,
      idempotency_key: body.idempotency_key ?? null,
      status: "pending",
    })
    .select("id, status")
    .single();
  if (error) return json({ error: error.message }, 500);

  await supabase.from("capability_events").insert({
    capability_id: body.capability_id,
    event_type: "approval_requested",
    actor,
    payload: redact({
      approval_id: ins.id,
      activity: body.activity,
      risk,
      requesting_module: body.requesting_module,
      tenant_id: body.tenant_id ?? null,
    }),
  });

  return json({ ok: true, approval_id: ins.id, status: ins.status });
}

async function decideApproval(req: Request, approvalId: string, actor: string) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return json({ error: "decision must be 'approved' or 'rejected'" }, 400);
  }

  const { data: row, error: fErr } = await supabase
    .from("approval_queue")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();
  if (fErr) return json({ error: fErr.message }, 500);
  if (!row) return json({ error: "approval not found" }, 404);
  if (row.status !== "pending") {
    return json({ ok: true, approval_id: row.id, status: row.status, replayed: true });
  }

  const decidedBy = body.decided_by ?? actor;
  const { data: upd, error: uErr } = await supabase
    .from("approval_queue")
    .update({
      status: decision,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      result: body.result ?? null,
    })
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (uErr) return json({ error: uErr.message }, 500);
  if (!upd) {
    // Lost race — re-read and return current
    const { data: cur } = await supabase.from("approval_queue").select("id, status").eq("id", approvalId).single();
    return json({ ok: true, approval_id: cur!.id, status: cur!.status, replayed: true });
  }

  await supabase.from("capability_events").insert({
    capability_id: row.capability_id ?? "unknown",
    event_type: "approval_decided",
    actor,
    payload: redact({
      approval_id: upd.id,
      decision,
      decided_by: decidedBy,
      requesting_module: row.requesting_module,
      tenant_id: row.tenant_id,
    }),
  });

  // Fire callback (best-effort). NEVER forward the global AWIP service
  // token — re-validate the URL (rules may have changed since insert) and
  // sign the body with APPROVAL_CALLBACK_SECRET so the receiver can verify
  // authenticity without holding the master token.
  if (row.callback_url) {
    if (!isCallbackUrlAllowed(String(row.callback_url))) {
      console.error(JSON.stringify({
        fn: "awip-api", severity: "warn", msg: "approval callback URL no longer allowed — skipping",
        approval_id: upd.id, callback_url: row.callback_url,
      }));
    } else {
      const payload = JSON.stringify({
        approval_id: upd.id,
        status: decision,
        decided_by: decidedBy,
        decided_at: upd.decided_at,
        activity: row.activity,
        capability_id: row.capability_id,
        intent_payload: row.intent_payload,
        result: upd.result,
      });
      const sig = await signCallbackBody(payload);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sig) headers["x-approval-signature"] = `sha256=${sig}`;
      fetch(row.callback_url, { method: "POST", headers, body: payload })
        .catch((e) => console.error(JSON.stringify({
          fn: "awip-api", severity: "warn", msg: "approval callback failed",
          approval_id: upd.id, callback_url: row.callback_url, error: String(e),
        })));
    }
  }

  return json({ ok: true, approval_id: upd.id, status: upd.status });
}

async function getApproval(approvalId: string) {
  const { data, error } = await supabase
    .from("approval_queue")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "approval not found" }, 404);
  return json({ approval: data });
}

async function listApprovals(url: URL) {
  const status = url.searchParams.get("status");
  const module = url.searchParams.get("module");
  const tenantId = url.searchParams.get("tenant_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  let q = supabase.from("approval_queue").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status) q = q.eq("status", status);
  if (module) q = q.eq("requesting_module", module);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ approvals: data, count: data?.length ?? 0 });
}

// ---------- onboarding checklist ----------
// The agent runs through this BEFORE executing: confirm goal, acknowledge required
// capabilities, request any required approvals, then mark ready_to_execute.

const ONBOARDING_ITEMS = [
  "goal_confirmed",
  "capabilities_acknowledged",
  "approvals_requested",
  "ready_to_execute",
] as const;
type OnboardingItem = typeof ONBOARDING_ITEMS[number];

function emptyChecklist() {
  const c: Record<string, { done: boolean; at: string | null; note: string | null }> = {};
  for (const k of ONBOARDING_ITEMS) c[k] = { done: false, at: null, note: null };
  return c;
}

async function startOnboarding(req: Request, actor: string, userId?: string) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const intent: string = String(body.intent ?? "").trim();
  if (!intent) return json({ error: "missing intent" }, 400);

  const capability_id: string | null = body.capability_id ? String(body.capability_id) : null;
  const activity: string | null = body.activity ? String(body.activity) : null;
  const goal_text: string | null = body.goal ? String(body.goal) : null;
  const requestedRisk: "low" | "medium" | "high" =
    ["low", "medium", "high"].includes(body.risk) ? body.risk : "medium";

  // Required capabilities: the requested one + its inputs_required (if registered).
  const required_capabilities: string[] = [];
  if (capability_id) {
    required_capabilities.push(capability_id);
    const { data: cap } = await supabase
      .from("capabilities")
      .select("id, inputs_required")
      .eq("id", capability_id)
      .maybeSingle();
    if (cap?.inputs_required && Array.isArray(cap.inputs_required)) {
      for (const dep of cap.inputs_required) {
        if (typeof dep === "string" && !required_capabilities.includes(dep)) {
          required_capabilities.push(dep);
        }
      }
    }
  }

  // Required approvals: based on agent scope verdict.
  const scope = await resolveActiveScope(req, userId);
  const required_approvals: string[] = [];
  let scopeVerdict: any = null;
  if (scope) {
    const verdict = checkScope(scope, {
      capability_id,
      tables: Array.isArray(body.tables) ? body.tables : [],
      risk: requestedRisk,
    });
    scopeVerdict = verdict;
    if (!verdict.ok) {
      for (const v of verdict.violations) required_approvals.push(v.code);
    }
  }
  // Anything medium/high also needs human approval per policy default.
  if (requestedRisk !== "low" && !required_approvals.includes("human_approval")) {
    required_approvals.push("human_approval");
  }

  const { data, error } = await supabase
    .from("agent_onboarding_sessions")
    .insert({
      agent_slug: scope?.agent_slug ?? "unknown",
      actor,
      user_id: userId ?? null,
      intent,
      goal_text,
      capability_id,
      activity,
      risk: requestedRisk,
      required_capabilities,
      required_approvals,
      checklist: emptyChecklist(),
      status: "pending",
      notes: scopeVerdict && !scopeVerdict.ok
        ? `Scope verdict: ${scopeVerdict.violations.map((v: { reason: string }) => v.reason).join(" ")}`
        : null,
    })
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    ok: true,
    session: data,
    scope_verdict: scopeVerdict,
    instructions: [
      "1. Read 'goal_text' back to the operator and call /onboarding/:id/confirm with item='goal_confirmed' once they agree.",
      "2. List 'required_capabilities' to the operator and confirm with item='capabilities_acknowledged'.",
      "3. For each entry in 'required_approvals', call POST /approvals/request, then confirm with item='approvals_requested' (include approval_id in notes).",
      "4. Only after all three are done, set item='ready_to_execute'. The session.status flips to 'ready' and the agent may execute.",
      "Never skip an item. If the operator declines, set status='aborted' via /onboarding/:id/confirm with item='ready_to_execute' and value=false.",
    ],
  });
}

async function confirmOnboarding(req: Request, sessionId: string, actor: string) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const item: string = String(body.item ?? "");
  if (!ONBOARDING_ITEMS.includes(item as OnboardingItem)) {
    return json({ error: `invalid item; expected one of ${ONBOARDING_ITEMS.join(", ")}` }, 400);
  }
  const value: boolean = body.value !== false; // default true
  const note: string | null = body.notes ? String(body.notes) : null;
  const approval_id: string | null = body.approval_id ? String(body.approval_id) : null;

  const { data: cur, error: getErr } = await supabase
    .from("agent_onboarding_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (getErr) return json({ error: getErr.message }, 500);
  if (!cur) return json({ error: "onboarding session not found" }, 404);

  const checklist = { ...(cur.checklist ?? emptyChecklist()) } as Record<string, any>;
  checklist[item] = { done: value, at: new Date().toISOString(), note, by: actor };

  let status = cur.status as string;
  let completed_at: string | null = cur.completed_at;
  if (item === "ready_to_execute") {
    if (value) {
      // Require all prior items done first.
      const missing = ONBOARDING_ITEMS.filter((k) => k !== "ready_to_execute" && !checklist[k]?.done);
      if (missing.length) {
        return json({
          ok: false,
          error: "prerequisites_incomplete",
          missing,
          message: `Cannot mark ready_to_execute; first complete: ${missing.join(", ")}.`,
        }, 409);
      }
      status = "ready";
      completed_at = new Date().toISOString();
    } else {
      status = "aborted";
      completed_at = new Date().toISOString();
    }
  } else if (status === "pending") {
    status = "in_progress";
  }

  const update: Record<string, unknown> = { checklist, status };
  if (completed_at) update.completed_at = completed_at;
  if (approval_id) update.approval_id = approval_id;

  const { data: upd, error: updErr } = await supabase
    .from("agent_onboarding_sessions")
    .update(update)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (updErr) return json({ error: updErr.message }, 500);
  return json({ ok: true, session: upd });
}

async function getOnboarding(sessionId: string) {
  const { data, error } = await supabase
    .from("agent_onboarding_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "not found" }, 404);
  return json({ session: data });
}

async function listOnboarding(url: URL) {
  const status = url.searchParams.get("status");
  const agent = url.searchParams.get("agent");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  let q = supabase.from("agent_onboarding_sessions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status) q = q.eq("status", status);
  if (agent) q = q.eq("agent_slug", agent);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ sessions: data, count: data?.length ?? 0 });
}

// ---------- notebook ----------

const NOTEBOOK_KINDS = ["thought", "issue", "research", "suggestion", "todo"] as const;
const NOTEBOOK_STATUSES = ["open", "in_progress", "resolved", "archived"] as const;

async function listNotebook(url: URL) {
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  let q = supabase.from("notebook_entries").select("*")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (kind) q = q.eq("kind", kind);
  if (status) q = q.eq("status", status);
  if (search) q = q.or(`title.ilike.%${search}%,body.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ entries: data, count: data?.length ?? 0 });
}

async function createNotebookEntry(req: Request, actor: string) {
  const body = await req.json().catch(() => ({}));
  if (!body.title) return json({ error: "title required" }, 400);
  const kind = NOTEBOOK_KINDS.includes(body.kind) ? body.kind : "thought";
  const status = NOTEBOOK_STATUSES.includes(body.status) ? body.status : "open";
  const { data, error } = await supabase.from("notebook_entries").insert({
    title: body.title,
    body: body.body ?? null,
    kind,
    status,
    tags: Array.isArray(body.tags) ? body.tags : [],
    pinned: !!body.pinned,
    author: body.author ?? actor,
  }).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, entry: data });
}

async function updateNotebookEntry(req: Request, id: string) {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.body === "string" || body.body === null) patch.body = body.body;
  if (NOTEBOOK_KINDS.includes(body.kind)) patch.kind = body.kind;
  if (NOTEBOOK_STATUSES.includes(body.status)) patch.status = body.status;
  if (Array.isArray(body.tags)) patch.tags = body.tags;
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  const { data, error } = await supabase.from("notebook_entries")
    .update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "not found" }, 404);
  return json({ ok: true, entry: data });
}

// ---------- copilot lessons ----------

const LESSON_SCOPES = ["global", "notebook", "approvals", "voice_style"] as const;
const LESSON_SOURCES = ["voice", "manual"] as const;

async function listLessons(url: URL) {
  const activeParam = url.searchParams.get("active");
  const scope = url.searchParams.get("scope");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 200);
  let q = supabase.from("copilot_lessons").select("*").order("created_at", { ascending: false }).limit(limit);
  if (activeParam === "true") q = q.eq("active", true);
  else if (activeParam === "false") q = q.eq("active", false);
  if (scope) q = q.eq("scope", scope);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ lessons: data, count: data?.length ?? 0 });
}

async function createLesson(req: Request, actor: string) {
  const body = await req.json().catch(() => ({}));
  const lesson = (body.lesson ?? "").toString().trim();
  if (!lesson) return json({ error: "lesson required" }, 400);
  if (lesson.length > 500) return json({ error: "lesson too long (max 500)" }, 400);
  const issues = scanLesson(lesson);
  if (issues.length > 0) {
    return json({
      error: `lesson appears to contain sensitive data (${describeIssues(issues)}); remove it before saving`,
      code: "lesson_unsafe",
      issues: issues.map((i) => ({ kind: i.kind })),
    }, 400);
  }
  const scope = LESSON_SCOPES.includes(body.scope) ? body.scope : "global";
  const source = LESSON_SOURCES.includes(body.source) ? body.source : "manual";
  const { data, error } = await supabase.from("copilot_lessons").insert({
    lesson, scope, source, created_by: actor,
    active: typeof body.active === "boolean" ? body.active : true,
  }).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, lesson: data });
}

async function updateLesson(req: Request, id: string) {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.lesson === "string") {
    const issues = scanLesson(body.lesson);
    if (issues.length > 0) {
      return json({
        error: `lesson appears to contain sensitive data (${describeIssues(issues)}); remove it before saving`,
        code: "lesson_unsafe",
        issues: issues.map((i) => ({ kind: i.kind })),
      }, 400);
    }
    patch.lesson = body.lesson;
  }
  if (LESSON_SCOPES.includes(body.scope)) patch.scope = body.scope;
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length === 0) return json({ error: "nothing to update" }, 400);
  const { data, error } = await supabase.from("copilot_lessons")
    .update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "not found" }, 404);
  return json({ ok: true, lesson: data });
}

async function deleteLesson(id: string) {
  const { error } = await supabase.from("copilot_lessons").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

// ---------- copilot transcripts ----------

async function listTranscripts(url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const { data, error } = await supabase
    .from("copilot_transcripts")
    .select("id, user_id, agent_slug, model, started_at, ended_at, turn_count, summary, analyzed_at")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  return json({ transcripts: data ?? [], count: data?.length ?? 0 });
}

async function getTranscript(id: string) {
  const { data: tr, error } = await supabase
    .from("copilot_transcripts").select("*").eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!tr) return json({ error: "not found" }, 404);
  const { data: turns } = await supabase
    .from("copilot_transcript_turns").select("*").eq("transcript_id", id).order("ord");
  return json({ transcript: tr, turns: turns ?? [] });
}

async function deleteTranscript(id: string) {
  const { error } = await supabase.from("copilot_transcripts").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function analyzeTranscript(id: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "ai gateway not configured" }, 500);
  const { data: tr } = await supabase
    .from("copilot_transcripts").select("*").eq("id", id).maybeSingle();
  if (!tr) return json({ error: "not found" }, 404);
  const { data: turns } = await supabase
    .from("copilot_transcript_turns").select("ord, role, content, latency_ms")
    .eq("transcript_id", id).order("ord");
  if (!turns?.length) return json({ error: "no turns to analyze" }, 400);

  const { data: lessons } = await supabase
    .from("copilot_lessons").select("lesson, scope").eq("active", true);
  const lessonBlock = (lessons ?? []).map((l) => `- [${l.scope}] ${l.lesson}`).join("\n") || "(none)";

  const transcriptText = turns.map((t) =>
    `[${t.ord}] ${t.role.toUpperCase()}${t.latency_ms ? ` (${t.latency_ms}ms)` : ""}: ${t.content}`
  ).join("\n");

  const sys = `You analyse Copilot voice transcripts for a single operator. Identify the FIRST turn where the assistant diverged from what the operator wanted (misunderstanding, wrong tool, ignored a lesson, hallucination, refusal, repetition). Return strict JSON:
{
  "diverged_at_ord": <int|null>,        // ord of the first problematic assistant turn, null if conversation is fine
  "divergence_summary": "<one sentence>",
  "likely_causes": ["<short cause>", ...],   // 1-4 items
  "suggested_lessons": ["<imperative rule under 140 chars>", ...] // 0-3 items, empty if none warranted
}
Active lessons (these were already in force):
${lessonBlock}`;

  const ANALYSIS_MODEL = pickModel("google/gemini-2.5-pro");
  const aiStart = Date.now();
  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Transcript (model=${tr.model ?? "?"}, agent=${tr.agent_slug ?? "?"}):\n\n${transcriptText}` },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!aiRes.ok) {
    const t = await aiRes.text();
    await logAiCall(supabase, { job: "awip-api:analyze-transcript", model: ANALYSIS_MODEL, trigger: "user", startedAt: aiStart, response: aiRes, errorText: t, request_ref: { transcript_id: id } });
    return json({ error: "ai gateway failed", detail: t.slice(0, 300) }, aiRes.status);
  }
  const aiBody = await aiRes.json();
  await logAiCall(supabase, { job: "awip-api:analyze-transcript", model: ANALYSIS_MODEL, trigger: "user", startedAt: aiStart, response: aiRes, json: aiBody, request_ref: { transcript_id: id } });
  let analysis: Record<string, unknown> = {};
  try { analysis = JSON.parse(aiBody.choices?.[0]?.message?.content ?? "{}"); } catch {}

  await supabase.from("copilot_transcripts").update({
    analysis, analyzed_at: new Date().toISOString(),
    summary: analysis.divergence_summary ?? null,
  }).eq("id", id);

  return json({ ok: true, analysis });
}

// ---------- s5.2/t2: resolver thresholds ----------

async function getResolverThresholds(): Promise<Response> {
  const { data, error } = await supabase
    .from("resolver_thresholds")
    .select("band, min_score, updated_at, updated_by")
    .order("min_score", { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ thresholds: data as ResolverThresholdRow[] });
}

async function putResolverThresholds(
  req: Request,
  actor: string,
  userId: string | undefined,
  idemKey: string | null,
): Promise<Response> {
  if (!(await isAdminActor(userId)) && !(userId && await isOperatorActor(userId))) {
    return json({ error: "operator role required" }, 403);
  }
  if (!idemKey) return json({ error: "Idempotency-Key header required" }, 400);

  let bodyText = "";
  try { bodyText = await req.text(); } catch { return json({ error: "invalid body" }, 400); }
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return json({ error: "invalid json" }, 400); }
  const v = ResolverThresholdsPutSchema.safeParse(parsed);
  if (!v.success) return json({ error: "validation failed", issues: v.error.flatten() }, 422);

  const bodyHash = await hashBody(bodyText);
  const idem = await checkIdempotencyConflict("resolver_thresholds_put", idemKey, bodyHash);
  if (idem.conflict) return json({ error: "Idempotency-Key reused with different body" }, 409);
  if (idem.cached) return json(idem.cached as Record<string, unknown>, 200);

  const { data: prevRows } = await supabase
    .from("resolver_thresholds")
    .select("band, min_score, updated_at, updated_by")
    .order("min_score", { ascending: false });
  const previous = (prevRows ?? []) as ResolverThresholdRow[];
  const prevByBand = new Map(previous.map((r) => [r.band, r.min_score]));

  const auditRows: Array<Record<string, unknown>> = [];
  for (const t of v.data.thresholds) {
    const before = prevByBand.get(t.band) ?? null;
    if (before === t.min_score) continue;
    auditRows.push({
      band: t.band,
      before_score: before,
      after_score: t.min_score,
      actor: userId ?? null,
      actor_label: actor,
      reason: v.data.reason,
      idempotency_key: idemKey,
    });
    const { error: upErr } = await supabase
      .from("resolver_thresholds")
      .update({ min_score: t.min_score, updated_at: new Date().toISOString(), updated_by: userId ?? null })
      .eq("band", t.band);
    if (upErr) return json({ error: upErr.message }, 500);
  }
  if (auditRows.length > 0) {
    await supabase.from("resolver_thresholds_audit").insert(auditRows);
  }

  const { data: curRows } = await supabase
    .from("resolver_thresholds")
    .select("band, min_score, updated_at, updated_by")
    .order("min_score", { ascending: false });
  const current = (curRows ?? []) as ResolverThresholdRow[];
  const response = { ok: true as const, previous, current };
  await storeIdempotency("resolver_thresholds_put", idemKey, null, response, bodyHash);
  return json(response);
}

async function isOperatorActor(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["operator", "admin"])
    .maybeSingle();
  return !!data;
}

async function getRecentResolverDecisions(url: URL): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const { data, error } = await supabase
    .from("resolver_decisions")
    .select("id, request_id, tenant_id, candidate_count, winning_node_id, match_source, score, confidence_band, authoritative_hit, latency_ms, actor_label, matched_kinds, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  return json({ decisions: data ?? [] });
}

// ---------- design-system tokens ----------
function hexToHslTriple(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function bucketPublicUrl(path: string | null): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from("tenant-branding").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

async function getDesignSystemTokens(url: URL): Promise<Response> {
  const tenantId = url.searchParams.get("tenant_id");
  const body: TokensResponse = {
    spec_version: DESIGN_SYSTEM_SPEC_VERSION,
    defaults: CORE_DEFAULT_TOKENS,
  };
  if (tenantId) {
    const { data, error } = await supabase
      .from("tenant_branding")
      .select("tenant_id, display_name, primary_hex, accent_hex, primary_foreground_hex, accent_foreground_hex, logo_light_path, logo_dark_path, favicon_path, og_image_path")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (data) {
      const primaryHsl = hexToHslTriple(data.primary_hex);
      const primaryFgHsl = hexToHslTriple(data.primary_foreground_hex);
      const accentHex = data.accent_hex ?? data.primary_hex;
      const accentFgHex = data.accent_foreground_hex ?? data.primary_foreground_hex;
      const accentHsl = hexToHslTriple(accentHex);
      const accentFgHsl = hexToHslTriple(accentFgHex);
      if (primaryHsl && primaryFgHsl && accentHsl && accentFgHsl) {
        body.tenant = {
          tenant_id: data.tenant_id,
          display_name: data.display_name ?? null,
          overrides: {
            primary: primaryHsl,
            "primary-foreground": primaryFgHsl,
            accent: accentHsl,
            "accent-foreground": accentFgHsl,
            ring: primaryHsl,
          },
          logo: {
            light_url: bucketPublicUrl(data.logo_light_path),
            dark_url: bucketPublicUrl(data.logo_dark_path),
            favicon_url: bucketPublicUrl(data.favicon_path),
            og_image_url: bucketPublicUrl(data.og_image_path),
          },
        };
      }
    }
  }
  return json(body);
}

Deno.serve(withLogger("awip-api", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  // Strip the function name prefix: /awip-api/...
  const path = url.pathname.replace(/^.*\/awip-api/, "") || "/";
  const started = Date.now();
  const idemKey = req.headers.get("idempotency-key");
  let actor = "anonymous";
  let response: Response;
  let logged = false;

  try {
    const idemCheck = validateIdemKey(idemKey);
    if (!idemCheck.ok) {
      response = json({ error: idemCheck.error }, 400);
    } else {
    const auth = await authorize(req);
    if (!auth.ok) {
      response = json({ error: auth.error ?? "unauthorized" }, 401);
    } else {
      actor = auth.actor;
      const spawnMatch = path.match(/^\/okr\/([0-9a-f-]+)\/spawn$/i);
      const supMatch = path.match(/^\/okr\/([0-9a-f-]+)\/supersede$/i);
      const capDetailMatch = path.match(/^\/capabilities\/([^\/]+)\/demand-detail$/i);
      const capPromoteStatusMatch = path.match(/^\/capabilities\/([^\/]+)\/promotion-status$/i);
      const capPromoteMatch = path.match(/^\/capabilities\/([^\/]+)\/promote$/i);
      const capAckMatch = path.match(/^\/capabilities\/([^\/]+)\/ack-warnings$/i);
      const approvalDecideMatch = path.match(/^\/approvals\/([0-9a-f-]+)\/decide$/i);
      const approvalGetMatch = path.match(/^\/approvals\/([0-9a-f-]+)$/i);
      const onboardingConfirmMatch = path.match(/^\/onboarding\/([0-9a-f-]+)\/confirm$/i);
      const onboardingGetMatch = path.match(/^\/onboarding\/([0-9a-f-]+)$/i);

      const notebookUpdateMatch = path.match(/^\/notebook\/([0-9a-f-]+)$/i);
      const lessonIdMatch = path.match(/^\/lessons\/([0-9a-f-]+)$/i);
      const transcriptIdMatch = path.match(/^\/transcripts\/([0-9a-f-]+)$/i);
      const transcriptAnalyzeMatch = path.match(/^\/transcripts\/([0-9a-f-]+)\/analyze$/i);

      if (req.method === "GET" && path === "/capabilities") response = await listCapabilities(url);
      else if (req.method === "POST" && path === "/capabilities/register") response = await registerCapability(req, auth.actor, auth.owning_module);
      else if (req.method === "POST" && path === "/modules/heartbeat") response = await moduleHeartbeat(req, auth.actor, auth.owning_module);

      else if (req.method === "POST" && path === "/okr/ingest") response = await ingestOkrTree(req, auth.actor);
      else if (req.method === "GET" && path === "/okr/tree") response = await getTree(url);
      else if (req.method === "GET" && path === "/events/recent") response = await getRecentEvents(url);
      else if (req.method === "POST" && path === "/events/ingest") response = await ingestEvents(req, auth.actor);
      else if (req.method === "GET" && path === "/capabilities/demand") response = await getCapabilityDemand(auth.actor);
      else if (req.method === "GET" && path === "/capabilities/promotion-status") response = await getPromotionStatus(auth.user_id);
      else if (req.method === "GET" && capPromoteStatusMatch) response = await getPromotionStatusOne(decodeURIComponent(capPromoteStatusMatch[1]), auth.user_id);
      else if (req.method === "POST" && capPromoteMatch) response = await promoteCapability(req, decodeURIComponent(capPromoteMatch[1]), auth.actor, auth.user_id);
      else if (req.method === "POST" && capAckMatch) response = await ackCapabilityWarnings(req, decodeURIComponent(capAckMatch[1]), auth.actor, auth.user_id);
      else if (req.method === "GET" && capDetailMatch) response = await getCapabilityDetail(decodeURIComponent(capDetailMatch[1]));
      else if (req.method === "POST" && spawnMatch) response = await spawnSubOkr(req, spawnMatch[1], auth.actor);
      else if (req.method === "POST" && supMatch) response = await supersedeOkr(req, supMatch[1], auth.actor);
      else if (req.method === "POST" && path === "/approvals/request") response = await requestApproval(req, auth.actor, auth.user_id);
      else if (req.method === "POST" && approvalDecideMatch) response = await decideApproval(req, approvalDecideMatch[1], auth.actor);
      else if (req.method === "GET" && approvalGetMatch) response = await getApproval(approvalGetMatch[1]);
      else if (req.method === "GET" && path === "/approvals") response = await listApprovals(url);
      else if (req.method === "POST" && path === "/onboarding/start") response = await startOnboarding(req, auth.actor, auth.user_id);
      else if (req.method === "POST" && onboardingConfirmMatch) response = await confirmOnboarding(req, onboardingConfirmMatch[1], auth.actor);
      else if (req.method === "GET" && onboardingGetMatch) response = await getOnboarding(onboardingGetMatch[1]);
      else if (req.method === "GET" && path === "/onboarding") response = await listOnboarding(url);
      else if (req.method === "GET" && path === "/notebook") response = await listNotebook(url);
      else if (req.method === "POST" && path === "/notebook") response = await createNotebookEntry(req, auth.actor);
      else if (req.method === "PATCH" && notebookUpdateMatch) response = await updateNotebookEntry(req, notebookUpdateMatch[1]);
      else if (req.method === "GET" && path === "/lessons") response = await listLessons(url);
      else if (req.method === "POST" && path === "/lessons") response = await createLesson(req, auth.actor);
      else if (req.method === "PATCH" && lessonIdMatch) response = await updateLesson(req, lessonIdMatch[1]);
      else if (req.method === "DELETE" && lessonIdMatch) response = await deleteLesson(lessonIdMatch[1]);
      else if (req.method === "GET" && path === "/transcripts") response = await listTranscripts(url);
      else if (req.method === "GET" && transcriptIdMatch) response = await getTranscript(transcriptIdMatch[1]);
      else if (req.method === "DELETE" && transcriptIdMatch) response = await deleteTranscript(transcriptIdMatch[1]);
      else if (req.method === "POST" && transcriptAnalyzeMatch) response = await analyzeTranscript(transcriptAnalyzeMatch[1]);
      else if (req.method === "GET" && path === "/night-agent/promotion-audit") response = await getPromotionAudit(url, auth.user_id);
      else if (req.method === "GET"  && path === "/resolver/thresholds") response = await getResolverThresholds();
      else if (req.method === "PUT"  && path === "/resolver/thresholds") response = await putResolverThresholds(req, auth.actor, auth.user_id, idemKey);
      else if (req.method === "GET"  && path === "/resolver/decisions")  response = await getRecentResolverDecisions(url);
      else if (req.method === "GET"  && path === "/design-system/tokens.json") response = await getDesignSystemTokens(url);
      else response = json({ error: "not found", path }, 404);
    }
    }
  } catch (e) {
    console.error(e);
    response = json({ error: (e as Error).message }, 500);
  }

  // Log (best-effort, non-blocking-ish)
  try {
    const cloned = response.clone();
    let body: any = null;
    try { body = await cloned.json(); } catch { /* non-JSON */ }
    const summary: Record<string, unknown> = {};
    let tenant_id: string | null = null;
    let replay = false;
    if (body && typeof body === "object") {
      if (body.tenant_id) tenant_id = body.tenant_id;
      if (Array.isArray(body.created)) summary.created_count = body.created.length;
      if (Array.isArray(body.warnings)) summary.warnings = body.warnings;
      if (Array.isArray(body.capabilities)) summary.capabilities_count = body.capabilities.length;
      if (body.error) summary.error = body.error;
      if (body.id) summary.id = body.id;
    }
    // Detect idempotent replay for okr/ingest
    if (path === "/okr/ingest" && idemKey && response.status === 200) {
      const { data } = await supabase
        .from("idempotency_keys")
        .select("created_at")
        .eq("scope", "okr_ingest")
        .eq("key", idemKey)
        .maybeSingle();
      if (data?.created_at && Date.now() - new Date(data.created_at).getTime() > 1500) {
        replay = true;
      }
    }
    await logApiCall({
      route: path,
      method: req.method,
      actor,
      idempotency_key: idemKey,
      idempotent_replay: replay,
      status_code: response.status,
      duration_ms: Date.now() - started,
      tenant_id,
      request_summary: { query: Object.fromEntries(url.searchParams) },
      response_summary: summary,
      error: body?.error ?? null,
    });
    logged = true;
  } catch (e) {
    if (!logged) console.error("log wrap failed", e);
  }

  return response;
}));
