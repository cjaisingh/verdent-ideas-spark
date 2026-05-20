// Night Agent — eligible-task audit pipeline.
// /open: pull eligible jobs, run 5-step QA per job, queue proposals with audit summary.
// /close: roll up shift digest from night_observations / night_task_audit.
// /smoke: gate exercise, writes marked test shift.
// /open?test=1 (admin only): read-only gate dry-run.
//
// Modules:
//   config.ts   — env, constants, types, json/cors helpers
//   time.ts     — local-time / window helpers
//   classify.ts — risk + phase/suite inference
//   filters.ts  — /open?test=1 query-string parsing
//   gates.ts    — admin test-mode handler
//   open.ts / close.ts / smoke.ts — main handlers

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, json, createServiceClient,
  SUPABASE_URL, ANON_KEY, SERVICE_TOKEN,
} from "./config.ts";
import { evaluateOpenGates } from "./gates.ts";
import { openShift } from "./open.ts";
import { closeShift } from "./close.ts";
import { smokeTest } from "./smoke.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import { withLogger } from "../_shared/logger.ts";
import { recordStep } from "../_shared/steps.ts";

const SETTINGS_COLS =
  "night_agent_enabled, night_timezone, night_window_start, night_window_end, night_blackout_dates, night_allowed_kinds";

Deno.serve(withLogger("night-agent", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  // Accept both subpath (/night-agent/close) and dash variant (/night-agent-close)
  // because pg_cron URLs historically used the dash form.
  let path = url.pathname.replace(/^.*\/night-agent/, "") || "/";
  if (path.startsWith("-")) path = "/" + path.slice(1);

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const sb = createServiceClient();

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    const reason = !provided
      ? "missing x-service-token header (cron secret not populated?)"
      : !SERVICE_TOKEN
        ? "AWIP_SERVICE_TOKEN env var not set on edge function"
        : "service token mismatch";
    const job = path.startsWith("/close") ? "night-agent-close" : "night-agent-open";
    const detail = { path, provided_present: !!provided, service_token_env_present: !!SERVICE_TOKEN };
    await sb.from("automation_runs").insert({
      job, trigger: "cron", status: "error", status_code: 401,
      message: reason, detail,
    });
    await dispatchAlert(sb, job, "auth_failed", `${job} 401 — ${reason}`, detail);
    return json({ error: "unauthorized", reason }, 401);
  }

  // Admin-only test mode: dry-run /open that returns gate evaluation
  // without writing a shift, observations, or proposals. Requires an
  // operator session JWT carrying the 'admin' role — never accepts the
  // cron service token (gate verification is a human action).
  const isOpenTest =
    path.startsWith("/open/test") ||
    (path.startsWith("/open") && (url.searchParams.get("test") === "1" || url.searchParams.get("dryRun") === "1"));
  if (isOpenTest) {
    if (triggeredByCron) return json({ error: "test mode requires operator JWT, not service token" }, 403);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const userId = claims.claims.sub as string;
    const userEmail = (claims.claims as any).email as string | undefined;
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return json({ error: "forbidden: admin role required" }, 403);

    const { data: settings } = await sb
      .from("memory_settings").select(SETTINGS_COLS).eq("id", true).maybeSingle();
    return await evaluateOpenGates(sb, settings ?? null, url, userId, userEmail, req);
  }

  const { data: settings } = await sb
    .from("memory_settings").select(SETTINGS_COLS).eq("id", true).maybeSingle();
  if (settings && settings.night_agent_enabled === false) {
    return json({ skipped: true, reason: "night_agent_disabled" });
  }

  const job = path.startsWith("/close") ? "night-agent-close"
            : path.startsWith("/smoke") ? "night-agent-smoke"
            : "night-agent-open";
  const trigger = triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();
  try {
    let res: Response;
    const stepLabel = path.startsWith("/open") ? "Open night shift"
                    : path.startsWith("/close") ? "Close night shift digest"
                    : "Night-agent smoke test";
    res = await recordStep(sb, {
      job, step_key: `compute:${job}`, step_label: stepLabel, phase_kind: "compute",
      detail: { path, trigger },
    }, async () => {
      if (path.startsWith("/open")) return openShift(sb, settings ?? null);
      if (path.startsWith("/close")) return closeShift(sb);
      if (path.startsWith("/smoke")) return smokeTest(sb, settings ?? null, url);
      return json({ error: "not_found", path }, 404);
    });
    try {
      const cloned = res.clone();
      const detail = await cloned.json().catch(() => ({}));
      await sb.from("automation_runs").insert({
        job, trigger, status: res.ok ? "ok" : "error", status_code: res.status,
        duration_ms: Date.now() - startedAt,
        message: res.ok ? `${job} completed` : `${job} returned ${res.status}`,
        detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
    return res;
  } catch (e) {
    console.error("night-agent", e);
    const msg = e instanceof Error ? e.message : "unknown";
    try {
      await sb.from("automation_runs").insert({
        job, trigger, status: "error", status_code: 500,
        duration_ms: Date.now() - startedAt, message: msg, detail: { path },
      });
    } catch {}
    return json({ error: msg }, 500);
  }
}));
