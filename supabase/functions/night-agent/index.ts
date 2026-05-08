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

const SETTINGS_COLS =
  "night_agent_enabled, night_timezone, night_window_start, night_window_end, night_blackout_dates, night_allowed_kinds";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/night-agent/, "") || "/";

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (!triggeredByCron && !auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const sb = createServiceClient();

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

  try {
    if (path.startsWith("/open")) return await openShift(sb, settings ?? null);
    if (path.startsWith("/close")) return await closeShift(sb);
    if (path.startsWith("/smoke")) return await smokeTest(sb, settings ?? null, url);
    return json({ error: "not_found", path }, 404);
  } catch (e) {
    console.error("night-agent", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
