// @observability: edge_function_error_rate, five_xx_spike
//
// session-summary-log — records a session summary row and (optionally) fans out
// `out_of_scope` bullets into discussion_actions via the shared autologger.
//
// Auth: operator JWT or x-awip-service-token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { recordOutOfScope } from "../_shared/out-of-scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-awip-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Body = {
  session_id: string;
  agent?: string;
  started_at?: string;
  ended_at?: string;
  goal?: string;
  outcome?: string;
  files_touched?: string[];
  migrations_applied?: string[];
  edge_fns_touched?: string[];
  open_findings_at_start?: unknown;
  open_actions_at_start?: unknown;
  open_findings_at_end?: unknown;
  open_actions_at_end?: unknown;
  decisions?: unknown;
  followups?: unknown;
  unresolved?: unknown;
  bootstrap_acknowledged?: boolean;
  out_of_scope?: string[];
};

Deno.serve(withLogger("session-summary-log", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-awip-service-token");
  const auth = req.headers.get("authorization") ?? "";
  if (!(SERVICE_TOKEN && provided === SERVICE_TOKEN) && !auth.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.session_id) return json({ error: "session_id_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const startedAt = body.started_at ?? new Date().toISOString();
  const endedAt = body.ended_at ?? new Date().toISOString();

  const { data: summary, error: insErr } = await sb
    .from("session_summaries")
    .insert({
      session_id: body.session_id,
      agent: body.agent ?? "lovable",
      started_at: startedAt,
      ended_at: endedAt,


  const { data: summary, error: insErr } = await sb
    .from("session_summaries")
    .insert({
      session_id: body.session_id,
      agent: body.agent ?? "lovable",
      started_at: startedAt,
      ended_at: endedAt,
      duration_minutes: duration,
      goal: body.goal ?? null,
      outcome: body.outcome ?? null,
      files_touched: body.files_touched ?? [],
      migrations_applied: body.migrations_applied ?? [],
      edge_fns_touched: body.edge_fns_touched ?? [],
      open_findings_at_start: body.open_findings_at_start ?? null,
      open_actions_at_start: body.open_actions_at_start ?? null,
      open_findings_at_end: body.open_findings_at_end ?? null,
      open_actions_at_end: body.open_actions_at_end ?? null,
      decisions: body.decisions ?? null,
      followups: body.followups ?? null,
      unresolved: body.unresolved ?? null,
      bootstrap_acknowledged: body.bootstrap_acknowledged ?? false,
    })
    .select("id")
    .single();
  if (insErr) return json({ error: "insert_failed", detail: insErr.message }, 500);

  let oos = { parsed_count: 0, created: [] as Array<{ id: string; title: string }>, skipped: [] as string[] };
  if (body.out_of_scope?.length) {
    try {
      oos = await recordOutOfScope(sb, {
        items: body.out_of_scope,
        source: "session_summary",
        source_ref: `session:${summary.id}`,
      });
    } catch (e) {
      console.error("recordOutOfScope failed", e);
    }
  }

  return json({ summary_id: summary.id, out_of_scope: oos });
}));
