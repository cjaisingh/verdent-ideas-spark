// Weekly QA validation: walks qa_checks, runs probes for mechanical ones,
// leaves judgement-type checks for the operator (status='unknown' until ticked).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

type Probe = (sb: ReturnType<typeof createClient>) => Promise<{ status: "pass" | "fail" | "unknown"; note: string }>;

// Probes are pure SQL counts so we never need to evaluate user input.
const PROBES: Record<string, Probe> = {
  // Phase 1: every API call logged
  "api_calls_logged_recent": async (sb) => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { count } = await sb.from("api_call_logs").select("id", { count: "exact", head: true }).gte("created_at", since);
    return { status: (count ?? 0) > 0 ? "pass" : "unknown", note: `${count ?? 0} API call logs in the last 7 days` };
  },
  // Phase 2: AI sessions leave a trail
  "work_log_recent": async (sb) => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { count } = await sb.from("roadmap_work_log").select("id", { count: "exact", head: true }).gte("created_at", since);
    return { status: (count ?? 0) > 0 ? "pass" : "fail", note: `${count ?? 0} work-log entries in the last 7 days` };
  },
  // Phase 2: every phase has a summary visible
  "all_phases_have_summary": async (sb) => {
    const { data } = await sb.from("roadmap_phases").select("key, summary");
    const missing = (data ?? []).filter((p: any) => !p.summary).map((p: any) => p.key);
    return missing.length
      ? { status: "fail", note: `phases missing summary: ${missing.join(", ")}` }
      : { status: "pass", note: "all phases have a summary" };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN")!;
  const provided = req.headers.get("x-service-token");
  if (provided !== SERVICE_TOKEN) {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: checks, error } = await sb.from("qa_checks").select("id, kind, probe");
  if (error) return json({ error: error.message }, 500);

  let updated = 0;
  for (const c of checks ?? []) {
    if (c.kind !== "probe" || !c.probe) continue;
    const probe = PROBES[c.probe];
    if (!probe) continue;
    try {
      const r = await probe(sb);
      await sb.from("qa_checks").update({
        status: r.status, note: r.note, last_checked_at: new Date().toISOString(),
      }).eq("id", c.id);
      updated++;
    } catch (e) {
      console.error("probe error", c.probe, e);
    }
  }

  return json({ ok: true, probes_run: updated });
});

function json(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
