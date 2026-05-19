// app-walkthrough — nightly self-walkthrough (route probes + capability self-tests).
//
// Auth: AWIP_SERVICE_TOKEN via x-service-token (cron) OR an operator bearer JWT (manual).
//
// Pipeline:
//   1. create walkthrough_runs row (running)
//   2. run static route probes (awip-api, edge fns, optional UI routes)
//   3. fetch capabilities with verify is not null, dispatch http|sql|edge
//   4. insert walkthrough_checks rows; update run totals/status
//   5. for each failure, upsert into sentinel_findings (kind='walkthrough_failure')
//
// Idempotency: cron triggers ~once/day; manual "Run now" creates a fresh run id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import { AWIP_API_PROBES, EDGE_FN_PROBES, uiRouteProbes, type RouteProbe } from "./probes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type CheckRow = {
  run_id: string;
  kind: "http" | "sql" | "edge" | "route";
  target: string;
  capability_id: string | null;
  status: "pass" | "fail" | "skip" | "error";
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  detail: Record<string, unknown>;
  severity: "info" | "low" | "medium" | "high" | "critical";
};

type VerifyConfig = {
  kind: "http" | "sql" | "edge";
  target: string;
  method?: string;
  expect?: { status?: number; json_has?: string[]; min_rows?: number; max_ms?: number };
  auth?: "service" | "none";
  severity?: CheckRow["severity"];
};

const FUNCTIONS_BASE = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "") + "/functions/v1";
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${FUNCTIONS_BASE}${path.startsWith("/") ? path : "/" + path}`;
}

async function runRouteProbe(p: RouteProbe, runId: string): Promise<CheckRow> {
  const url = buildUrl(p.path);
  const method = p.method ?? "GET";
  const expectStatus = p.expectStatus ?? [200];
  const maxMs = p.maxMs ?? 8000;
  const headers: Record<string, string> = {};
  if (p.auth === "service" && SERVICE_TOKEN) {
    headers["x-service-token"] = SERVICE_TOKEN;
    headers["x-awip-service-token"] = SERVICE_TOKEN;
  }
  if (ANON && !/^https?:\/\//i.test(p.path)) headers["apikey"] = ANON;

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), maxMs + 2000);
    const res = await fetch(url, { method, headers, signal: ctrl.signal });
    clearTimeout(timer);
    // Always consume body to avoid Deno leaks.
    await res.text();
    const ms = Date.now() - t0;
    const ok = expectStatus.includes(res.status) && ms <= maxMs;
    return {
      run_id: runId,
      kind: url.startsWith(FUNCTIONS_BASE) ? "http" : "route",
      target: p.target,
      capability_id: null,
      status: ok ? "pass" : "fail",
      latency_ms: ms,
      http_status: res.status,
      error: ok ? null : `expected ${expectStatus.join("|")} <= ${maxMs}ms, got ${res.status} in ${ms}ms`,
      detail: { url, method },
      severity: p.severity ?? "medium",
    };
  } catch (e) {
    return {
      run_id: runId,
      kind: "http",
      target: p.target,
      capability_id: null,
      status: "error",
      latency_ms: Date.now() - t0,
      http_status: null,
      error: (e as Error).message,
      detail: { url, method },
      severity: p.severity ?? "medium",
    };
  }
}

async function runCapabilityVerify(
  capId: string,
  cfg: VerifyConfig,
  runId: string,
  sb: ReturnType<typeof createClient>,
): Promise<CheckRow> {
  const severity: CheckRow["severity"] = cfg.severity ?? "medium";
  const maxMs = cfg.expect?.max_ms ?? 8000;
  const t0 = Date.now();

  if (cfg.kind === "sql") {
    try {
      const { data, error } = await sb.rpc("run_capability_sql_check", {
        _sql: cfg.target,
        _min_rows: cfg.expect?.min_rows ?? 0,
      });
      const row = Array.isArray(data) ? (data[0] as { row_count: number; ok: boolean }) : null;
      const ms = Date.now() - t0;
      const ok = !error && row?.ok === true && ms <= maxMs;
      return {
        run_id: runId, kind: "sql", target: cfg.target.slice(0, 200), capability_id: capId,
        status: ok ? "pass" : "fail", latency_ms: ms, http_status: null,
        error: error?.message ?? (ok ? null : `min_rows=${cfg.expect?.min_rows ?? 0} not met (got ${row?.row_count ?? "?"})`),
        detail: { row_count: row?.row_count ?? null }, severity,
      };
    } catch (e) {
      return {
        run_id: runId, kind: "sql", target: cfg.target.slice(0, 200), capability_id: capId,
        status: "error", latency_ms: Date.now() - t0, http_status: null,
        error: (e as Error).message, detail: {}, severity,
      };
    }
  }

  // http or edge — both end up as fetch
  const isEdge = cfg.kind === "edge";
  const url = isEdge ? buildUrl("/" + cfg.target.replace(/^\//, "")) : buildUrl(cfg.target);
  const method = (cfg.method ?? (isEdge ? "POST" : "GET")).toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.auth !== "none" && SERVICE_TOKEN) {
    headers["x-service-token"] = SERVICE_TOKEN;
    headers["x-awip-service-token"] = SERVICE_TOKEN;
  }
  if (ANON) headers["apikey"] = ANON;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), maxMs + 2000);
    const res = await fetch(url, {
      method, headers, signal: ctrl.signal,
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify({ probe: true }),
    });
    clearTimeout(timer);
    const text = await res.text();
    const ms = Date.now() - t0;
    const expectedStatus = cfg.expect?.status ?? 200;
    let jsonOk = true;
    if (cfg.expect?.json_has?.length) {
      try {
        const parsed = JSON.parse(text);
        jsonOk = cfg.expect.json_has.every((k) => parsed && Object.prototype.hasOwnProperty.call(parsed, k));
      } catch { jsonOk = false; }
    }
    const ok = res.status === expectedStatus && ms <= maxMs && jsonOk;
    return {
      run_id: runId, kind: cfg.kind, target: cfg.target, capability_id: capId,
      status: ok ? "pass" : "fail", latency_ms: ms, http_status: res.status,
      error: ok ? null : `status=${res.status}/${expectedStatus} jsonOk=${jsonOk} ms=${ms}/${maxMs}`,
      detail: { url, method }, severity,
    };
  } catch (e) {
    return {
      run_id: runId, kind: cfg.kind, target: cfg.target, capability_id: capId,
      status: "error", latency_ms: Date.now() - t0, http_status: null,
      error: (e as Error).message, detail: { url, method }, severity,
    };
  }
}

function isOperatorAllowed(_req: Request): boolean { return true; } // server-role check is implicit via JWT validation below

Deno.serve(withLogger("app-walkthrough", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE, { auth: { persistSession: false } });

  // Auth: service token (cron) OR operator JWT
  const provided = req.headers.get("x-service-token");
  const authHeader = req.headers.get("authorization") ?? "";
  let trigger: "cron" | "manual" = "cron";
  if (!SERVICE_TOKEN || provided !== SERVICE_TOKEN) {
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsRes, error: claimsErr } = await sbAuth.auth.getClaims(token);
    if (claimsErr || !claimsRes?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const uid = claimsRes.claims.sub;
    const { data: roleRes } = await sb.from("user_roles").select("role").eq("user_id", uid);
    const roles = (roleRes ?? []).map((r) => r.role);
    if (!roles.includes("operator") && !roles.includes("admin")) return json({ error: "forbidden" }, 403);
    trigger = "manual";
    if (!isOperatorAllowed(req)) return json({ error: "forbidden" }, 403);
  }

  // Optional preview-origin override for UI route probes (POST body { preview_origin })
  // Falls back to WALKTHROUGH_PREVIEW_ORIGIN env var so cron-triggered runs probe UI routes too.
  let previewOrigin = "";
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      previewOrigin = typeof body?.preview_origin === "string" ? body.preview_origin : "";
    }
  } catch { /* ignore */ }
  if (!previewOrigin) {
    previewOrigin = Deno.env.get("WALKTHROUGH_PREVIEW_ORIGIN") ?? "";
  }

  const startedAt = Date.now();
  const { data: runRow, error: runErr } = await sb
    .from("walkthrough_runs")
    .insert({ trigger, status: "running" })
    .select("id")
    .single();
  if (runErr || !runRow) return json({ error: "could not create run", detail: runErr?.message }, 500);
  const runId = runRow.id as string;

  // 1. Static probes
  const probes: RouteProbe[] = [
    ...AWIP_API_PROBES,
    ...EDGE_FN_PROBES,
    ...uiRouteProbes(previewOrigin),
  ];
  const probeResults: CheckRow[] = [];
  for (const p of probes) probeResults.push(await runRouteProbe(p, runId));

  // 2. Capability self-tests
  const { data: caps } = await sb
    .from("capabilities")
    .select("id, verify")
    .not("verify", "is", null);
  const capResults: CheckRow[] = [];
  for (const c of caps ?? []) {
    const cfg = c.verify as VerifyConfig;
    if (!cfg || !cfg.kind || !cfg.target) {
      capResults.push({
        run_id: runId, kind: "http", target: c.id, capability_id: c.id,
        status: "skip", latency_ms: null, http_status: null,
        error: "invalid verify config", detail: {}, severity: "low",
      });
      continue;
    }
    capResults.push(await runCapabilityVerify(c.id, cfg, runId, sb));
  }

  const all = [...probeResults, ...capResults];
  if (all.length) {
    // Insert in chunks to avoid payload limits
    for (let i = 0; i < all.length; i += 100) {
      await sb.from("walkthrough_checks").insert(all.slice(i, i + 100));
    }
  }

  const passed = all.filter((c) => c.status === "pass").length;
  const failed = all.filter((c) => c.status === "fail" || c.status === "error").length;
  const skipped = all.filter((c) => c.status === "skip").length;
  const status = failed === 0 ? "ok" : passed > 0 ? "partial" : "failed";

  await sb.from("walkthrough_runs").update({
    status, finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    total: all.length, passed, failed, skipped,
    summary: {
      probes: probeResults.length,
      capabilities: capResults.length,
      caps_with_verify: (caps ?? []).length,
    },
  }).eq("id", runId);

  // 3. Failure → sentinel_findings (upsert by dedupe_key)
  for (const c of all) {
    if (c.status !== "fail" && c.status !== "error") continue;
    const dedupe = `walkthrough:${c.target}`;
    const summary = `Walkthrough ${c.status}: ${c.target}`;
    const { data: existing } = await sb
      .from("sentinel_findings")
      .select("id, status")
      .eq("dedupe_key", dedupe)
      .maybeSingle();
    if (existing) {
      await sb.from("sentinel_findings").update({
        last_seen_at: new Date().toISOString(),
        status: existing.status === "muted" ? "muted" : "open",
        severity: c.severity,
        summary,
        payload: { run_id: runId, target: c.target, error: c.error, latency_ms: c.latency_ms, http_status: c.http_status },
      }).eq("id", existing.id);
    } else {
      await sb.from("sentinel_findings").insert({
        kind: "walkthrough_failure",
        severity: c.severity,
        summary,
        dedupe_key: dedupe,
        subject_ref: { capability_id: c.capability_id, target: c.target },
        payload: { run_id: runId, error: c.error, latency_ms: c.latency_ms, http_status: c.http_status },
      });
    }
  }

  return json({
    run_id: runId, status, total: all.length, passed, failed, skipped,
    duration_ms: Date.now() - startedAt,
  });
}));
