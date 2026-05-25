// @observability: edge_function_error_rate, five_xx_spike
//
// session-replay — re-runs the deferral fan-out for an existing session_summary.
// Idempotent: relies on uniq_discussion_actions_autolog (source, source_ref, title)
// so re-POSTing the same summary collapses onto the original rows.
//
// Use cases:
//   - Original session-summary-log call failed mid-fan-out (partial promote).
//   - Operator added new out_of_scope[] items they want re-fanned.
//   - Original `unresolved[]` items never made it to discussion_actions.
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
  summary_id: string;
  /** Extra out-of-scope bullets to merge into the replay (deduped by title). */
  extra_out_of_scope?: string[];
  /** Default false — when true, also re-fans `unresolved[]` from the row. */
  include_unresolved?: boolean;
};

Deno.serve(withLogger("session-replay", async (req) => {
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
  if (!body.summary_id) return json({ error: "summary_id_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: summary, error: sErr } = await sb
    .from("session_summaries")
    .select("id, session_id, agent, unresolved, followups")
    .eq("id", body.summary_id)
    .maybeSingle();
  if (sErr) return json({ error: "lookup_failed", detail: sErr.message }, 500);
  if (!summary) return json({ error: "summary_not_found" }, 404);

  const items: string[] = [];
  if (body.include_unresolved && Array.isArray(summary.unresolved)) {
    items.push(...summary.unresolved);
  }
  if (body.extra_out_of_scope?.length) items.push(...body.extra_out_of_scope);

  if (items.length === 0) {
    return json({
      summary_id: summary.id,
      replayed: { parsed_count: 0, created: [], skipped: [] },
      note: "no_items_supplied",
    });
  }

  const oos = await recordOutOfScope(sb, {
    items,
    source: "session_summary",
    source_ref: `session:${summary.id}`,
  });

  return json({
    summary_id: summary.id,
    session_id: summary.session_id,
    agent: summary.agent,
    replayed: oos,
  });
}));
