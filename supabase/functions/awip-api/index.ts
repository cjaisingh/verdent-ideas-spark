// AWIP Core contract API.
// Routes:
//   GET  /capabilities                     -> list capabilities
//   POST /capabilities/register            -> register a capability (stub for module projects)
//   POST /okr/ingest                       -> ingest a draft OKR tree (idempotent)
//   POST /okr/:id/spawn                    -> spawn a sub-OKR
//   POST /okr/:id/supersede                -> supersede an OKR with a new node
//   GET  /okr/tree?tenant_id=...           -> fetch full tree (incl. superseded)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------- redaction ----------
// Scrub secrets from anything we persist (api_call_logs, *_events.payload).
// Defensive: walk strings, leave non-strings alone, cap recursion depth.
const SERVICE_TOKEN_VALUE = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
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

// Auth: require either a valid operator JWT OR the AWIP_SERVICE_TOKEN header (for cross-project calls).
async function authorize(req: Request): Promise<{ ok: boolean; actor: string; error?: string }> {
  const serviceToken = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-awip-service-token");
  if (serviceToken && provided && provided === serviceToken) {
    return { ok: true, actor: "service:discovery_ai" };
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
  return { ok: true, actor: `user:${data.user.id}` };
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
      request_summary: entry.request_summary ?? {},
      response_summary: entry.response_summary ?? {},
      error: entry.error ?? null,
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
  const stored = (data.response as any)?.__body_hash;
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

async function registerCapability(req: Request, actor: string) {
  const body = await req.json();
  const required = ["id", "name", "status"];
  for (const k of required) if (!body[k]) return json({ error: `missing ${k}` }, 400);
  const { error } = await supabase.from("capabilities").upsert({
    id: body.id,
    name: body.name,
    description: body.description ?? null,
    status: body.status,
    version: body.version ?? "0.1.0",
    inputs_required: body.inputs_required ?? [],
    outputs_provided: body.outputs_provided ?? [],
    owning_module: body.owning_module ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) return json({ error: error.message }, 500);
  await supabase.from("capability_events").insert({
    capability_id: body.id,
    event_type: "registered",
    payload: body,
    actor,
  });
  return json({ ok: true, id: body.id });
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
    const { __body_hash, ...rest } = conflict.cached as any;
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
      payload: { client_id: n.client_id },
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
    payload: { parent_id: parent.id, reason: body.spawned_from_reason },
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
      payload: { superseded_by: ins.data.id, reason: body.reason },
      actor,
    },
    {
      tenant_id: old.tenant_id,
      okr_node_id: ins.data.id,
      event_type: "created",
      payload: { supersedes: oldId },
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
    const { __body_hash, ...rest } = conflict.cached as any;
    return json(rest);
  }

  const events = Array.isArray(body?.events) ? body.events : null;
  if (!events || events.length === 0) return json({ error: "events[] required" }, 400);

  const rows = events.map((e: any) => ({
    capability_id: String(e.capability_id ?? ""),
    event_type: String(e.event_type ?? ""),
    payload: e.payload ?? {},
    actor,
  }));
  if (rows.some((r: any) => !r.capability_id || !r.event_type)) {
    return json({ error: "each event needs capability_id and event_type" }, 400);
  }

  const { data, error } = await supabase.from("capability_events").insert(rows).select("id, created_at");
  if (error) return json({ error: error.message }, 500);
  const response = { ok: true, inserted: data?.length ?? 0, ids: (data ?? []).map((d: any) => d.id) };
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
    ...(o.data ?? []).map((e: any) => ({
      id: e.id, source: "okr", ref: e.okr_node_id, tenant_id: e.tenant_id,
      event_type: e.event_type, payload: e.payload, actor: e.actor, created_at: e.created_at,
    })),
    ...(c.data ?? []).map((e: any) => ({
      id: e.id, source: "capability", ref: e.capability_id, tenant_id: null,
      event_type: e.event_type, payload: e.payload, actor: e.actor, created_at: e.created_at,
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);

  return json({ events: merged, count: merged.length });
}

async function getCapabilityDemand() {
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

  const nodeById = new Map((nodesRes.data ?? []).map((n: any) => [n.id, n]));
  type Agg = { tenants: Set<string>; krs: Set<string>; active_krs: Set<string> };
  const agg = new Map<string, Agg>();

  for (const m of measRes.data ?? []) {
    const node = nodeById.get((m as any).okr_node_id);
    if (!node) continue;
    for (const capId of ((m as any).required_capabilities ?? []) as string[]) {
      let a = agg.get(capId);
      if (!a) { a = { tenants: new Set(), krs: new Set(), active_krs: new Set() }; agg.set(capId, a); }
      a.tenants.add((node as any).tenant_id);
      a.krs.add((m as any).okr_node_id);
      if ((node as any).status !== "superseded") a.active_krs.add((m as any).okr_node_id);
    }
  }

  const rowFor = (c: any, a?: Agg) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    owning_module: c.owning_module,
    tenant_ids: [...(a?.tenants ?? [])],
    tenant_count: a?.tenants.size ?? 0,
    kr_count: a?.krs.size ?? 0,
    active_kr_count: a?.active_krs.size ?? 0,
  });

  const demand = (capsRes.data ?? []).map((c: any) => rowFor(c, agg.get(c.id)));

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

  return json({ demand, tenants: tenantsRes.data ?? [] });
}

async function getCapabilityDetail(capId: string) {
  const { data: cap } = await supabase.from("capabilities").select("*").eq("id", capId).maybeSingle();

  // Find measurements that reference this capability
  const { data: meas, error: mErr } = await supabase
    .from("okr_measurements")
    .select("okr_node_id, metric_name, target, unit, cadence, required_capabilities");
  if (mErr) return json({ error: mErr.message }, 500);
  const matching = (meas ?? []).filter((m: any) =>
    (m.required_capabilities ?? []).includes(capId)
  );
  const nodeIds = [...new Set(matching.map((m: any) => m.okr_node_id))];

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

  const tenantIds = [...new Set((nodes ?? []).map((n: any) => n.tenant_id))];
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, slug, name")
    .in("id", tenantIds);
  const tenantById = new Map((tenants ?? []).map((t: any) => [t.id, t]));

  const measByNode = new Map(matching.map((m: any) => [m.okr_node_id, m]));

  // Parent objective lookup
  const parentIds = [...new Set((nodes ?? []).map((n: any) => n.parent_id).filter(Boolean))];
  const { data: parents } = parentIds.length
    ? await supabase.from("okr_nodes").select("id, title").in("id", parentIds)
    : { data: [] as any[] };
  const parentById = new Map((parents ?? []).map((p: any) => [p.id, p]));

  const krs = (nodes ?? []).map((n: any) => ({
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

// ---------- router ----------

Deno.serve(async (req) => {
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

      if (req.method === "GET" && path === "/capabilities") response = await listCapabilities(url);
      else if (req.method === "POST" && path === "/capabilities/register") response = await registerCapability(req, auth.actor);
      else if (req.method === "POST" && path === "/okr/ingest") response = await ingestOkrTree(req, auth.actor);
      else if (req.method === "GET" && path === "/okr/tree") response = await getTree(url);
      else if (req.method === "GET" && path === "/events/recent") response = await getRecentEvents(url);
      else if (req.method === "POST" && path === "/events/ingest") response = await ingestEvents(req, auth.actor);
      else if (req.method === "GET" && path === "/capabilities/demand") response = await getCapabilityDemand();
      else if (req.method === "GET" && capDetailMatch) response = await getCapabilityDetail(decodeURIComponent(capDetailMatch[1]));
      else if (req.method === "POST" && spawnMatch) response = await spawnSubOkr(req, spawnMatch[1], auth.actor);
      else if (req.method === "POST" && supMatch) response = await supersedeOkr(req, supMatch[1], auth.actor);
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
});
