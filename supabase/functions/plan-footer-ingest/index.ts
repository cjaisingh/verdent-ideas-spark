// @observability: edge_function_error_rate, five_xx_spike
//
// plan-footer-ingest — POST a plan markdown (or pre-extracted bullets) and
// turn the "Out of scope" footer into discussion_actions. Idempotent via the
// (source, source_ref, title) unique index.
//
// Auth: operator JWT (Bearer) OR x-awip-service-token for cross-project calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { parseOutOfScope, recordOutOfScope } from "../_shared/out-of-scope.ts";

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

type Origin = "core" | "companion" | "rork";
type Body = {
  plan_id?: string;
  plan_markdown?: string;
  /** Optional pre-extracted items — bypasses parsing. */
  items?: string[];
  default_priority?: "low" | "med" | "high";
  /** Origin project for the plan; defaults to "core". Stamps source_ref as plan:<origin>:<id>. */
  origin?: Origin;
};


Deno.serve(withLogger("plan-footer-ingest", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-awip-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (!isService && !auth.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body.plan_id) return json({ error: "plan_id_required" }, 400);
  if (!body.plan_markdown && !body.items) {
    return json({ error: "plan_markdown_or_items_required" }, 400);
  }

  const items = body.items ?? parseOutOfScope(body.plan_markdown ?? "");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const result = await recordOutOfScope(sb, {
      items,
      source: "plan_footer",
      source_ref: `plan:${body.plan_id}`,
      default_priority: body.default_priority,
    });
    return json({
      plan_id: body.plan_id,
      parsed_count: result.parsed_count,
      created_count: result.created.length,
      skipped_count: result.skipped.length,
      created: result.created,
      skipped: result.skipped,
    });
  } catch (e) {
    console.error("plan-footer-ingest failed", e);
    return json({ error: "ingest_failed", detail: String(e) }, 500);
  }
}));
