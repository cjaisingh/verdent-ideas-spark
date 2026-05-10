// Per-turn environment snapshot for the browser /companion chat.
// POST /  -> { markdown, sections: {...}, generated_at, size }
// Operator JWT required. Read-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-awip-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function authorize(req: Request): Promise<{ uid: string } | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles?.some((r) => r.role === "operator" || r.role === "admin")) return null;
  return { uid: data.user.id };
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "";
  try { return new Date(s).toISOString().slice(0, 16).replace("T", " "); } catch { return s; }
}

Deno.serve(withLogger("awip-companion-context", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const who = await authorize(req);
  if (!who) return json({ error: "unauthorized" }, 401);

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  // Fire all reads in parallel; tolerate failures per-section.
  const safe = async <T>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> => {
    try { const r = await p; return r.error ? null : (r.data as T | null); } catch { return null; }
  };

  const [
    jobsOpen, jobsCounts7d, roadmap, sentinel, automation, audits,
    plan, review, aiUsage, capEvents, okrEvents, lessonsUser, lessonsGlobal,
  ] = await Promise.all([
    safe<any[]>(admin.from("discussion_actions")
      .select("id,short_num,title,priority,status,owner,due_at,night_eligible,created_at")
      .in("status", ["open", "in_progress"])
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(25) as any),
    safe<any[]>(admin.from("discussion_actions")
      .select("status,night_eligible,created_at,updated_at").gte("updated_at", weekAgo).limit(500) as any),
    safe<any[]>(admin.from("roadmap_tasks")
      .select("id,title,status,module,owner,updated_at").order("updated_at", { ascending: false }).limit(15) as any),
    safe<any[]>(admin.from("sentinel_findings")
      .select("id,kind,severity,summary,created_at,resolved_at")
      .gte("created_at", dayAgo).order("created_at", { ascending: false }).limit(15) as any),
    safe<any[]>(admin.from("automation_runs")
      .select("id,job,status,trigger,duration_ms,message,created_at").order("created_at", { ascending: false }).limit(8) as any),
    safe<any[]>(admin.from("deep_audit_runs")
      .select("id,cadence,status,summary,started_at,finished_at").order("started_at", { ascending: false }).limit(5) as any),
    safe<any>(admin.from("daily_plans").select("for_date,focus,plan_md,risks,recommendations").order("for_date", { ascending: false }).limit(1).maybeSingle() as any),
    safe<any>(admin.from("morning_reviews").select("review_date,kpis,stuck_jobs,top_actions,open_findings").order("review_date", { ascending: false }).limit(1).maybeSingle() as any),
    safe<any[]>(admin.from("ai_usage_log").select("model,prompt_tokens,completion_tokens,cost_usd,created_at").gte("created_at", dayAgo).limit(2000) as any),
    safe<any[]>(admin.from("capability_events").select("event_type,capability_id,created_at").order("created_at", { ascending: false }).limit(10) as any),
    safe<any[]>(admin.from("okr_node_events").select("event_type,node_id,created_at").order("created_at", { ascending: false }).limit(10) as any),
    safe<any[]>(admin.from("copilot_lessons").select("scope,lesson,created_at").eq("created_by", who.uid).eq("active", true).order("created_at", { ascending: false }).limit(30) as any),
    safe<any[]>(admin.from("lessons").select("title,summary,severity,created_at").order("created_at", { ascending: false }).limit(10) as any),
  ]);

  const lines: string[] = [];
  lines.push("## Live AWIP environment snapshot");
  lines.push(`_Generated ${new Date().toISOString()} — read-only, refreshed each turn._`);
  lines.push("");

  // Jobs
  const open = jobsOpen ?? [];
  const c7 = jobsCounts7d ?? [];
  const cntOpen = c7.filter((r: any) => r.status === "open").length;
  const cntInProg = c7.filter((r: any) => r.status === "in_progress").length;
  const cntDone7 = c7.filter((r: any) => r.status === "done").length;
  const cntNight = c7.filter((r: any) => r.night_eligible && r.status !== "done").length;
  lines.push(`### [Jobs] discussion_actions — ${cntOpen} open · ${cntInProg} in_progress · ${cntDone7} done(7d) · ${cntNight} night-eligible`);
  if (open.length === 0) {
    lines.push("_(no open jobs)_");
  } else {
    for (const j of open.slice(0, 25)) {
      lines.push(`- J-${j.short_num ?? j.id?.slice(0, 6)} [${j.priority}/${j.status}${j.night_eligible ? "/night" : ""}] ${j.title} ${j.owner ? `· @${j.owner}` : ""}`);
    }
  }
  lines.push("");

  // Roadmap
  if (roadmap?.length) {
    lines.push(`### [Roadmap] roadmap_tasks (latest 15)`);
    for (const t of roadmap) lines.push(`- [${t.status}] ${t.title} ${t.module ? `· ${t.module}` : ""} ${t.owner ? `· @${t.owner}` : ""}`);
    lines.push("");
  }

  // Last night
  if (sentinel?.length || automation?.length) {
    lines.push(`### [Last night] sentinel + automation`);
    for (const s of (sentinel ?? []).slice(0, 8)) lines.push(`- sentinel/${s.severity}: ${s.summary ?? s.kind} (${fmtDate(s.created_at)}${s.resolved_at ? " · resolved" : ""})`);
    for (const a of (automation ?? []).slice(0, 6)) lines.push(`- run/${a.status}: ${a.job} ${a.message ? `— ${String(a.message).slice(0, 120)}` : ""} (${fmtDate(a.created_at)})`);
    lines.push("");
  }

  // Audits
  if (audits?.length) {
    lines.push(`### [Audits] deep_audit_runs (latest 5)`);
    for (const a of audits) lines.push(`- ${a.cadence}/${a.status} (${fmtDate(a.started_at)})`);
    lines.push("");
  }

  // Today
  if (plan || review) {
    lines.push(`### [Today]`);
    if (plan) lines.push(`- Daily plan ${plan.for_date}: focus=${plan.focus ?? "—"}`);
    if (review) lines.push(`- Morning review ${review.review_date}: stuck=${(review.stuck_jobs as any[])?.length ?? 0} actions=${(review.top_actions as any[])?.length ?? 0} findings=${(review.open_findings as any[])?.length ?? 0}`);
    lines.push("");
  }

  // AI usage 24h
  if (aiUsage?.length) {
    const calls = aiUsage.length;
    const tokens = aiUsage.reduce((a: number, r: any) => a + (r.prompt_tokens || 0) + (r.completion_tokens || 0), 0);
    const cost = aiUsage.reduce((a: number, r: any) => a + Number(r.cost_usd || 0), 0);
    const models = new Set(aiUsage.map((r: any) => r.model)).size;
    lines.push(`### [Health] ai_usage 24h: ${calls} calls · ${tokens} tokens · $${cost.toFixed(3)} · ${models} model(s)`);
    lines.push("");
  }

  // OKR / capability events
  if (okrEvents?.length || capEvents?.length) {
    lines.push(`### [Events]`);
    for (const e of (okrEvents ?? []).slice(0, 5)) lines.push(`- okr/${e.event_type} on ${e.node_id?.slice(0, 8)} (${fmtDate(e.created_at)})`);
    for (const e of (capEvents ?? []).slice(0, 5)) lines.push(`- cap/${e.event_type} on ${e.capability_id} (${fmtDate(e.created_at)})`);
    lines.push("");
  }

  // Lessons
  const lUser = lessonsUser ?? [];
  const lGlobal = lessonsGlobal ?? [];
  if (lUser.length || lGlobal.length) {
    lines.push(`### [Lessons] active learning (${lUser.length} personal · ${lGlobal.length} global)`);
    for (const l of lUser.slice(0, 20)) lines.push(`- (${l.scope}) ${l.lesson}`);
    for (const l of lGlobal.slice(0, 8)) lines.push(`- [global/${l.severity ?? "info"}] ${l.title}: ${(l.summary ?? "").slice(0, 140)}`);
    lines.push("");
  }

  let markdown = lines.join("\n");
  // Cap at ~6 KB
  const MAX = 6000;
  if (markdown.length > MAX) markdown = markdown.slice(0, MAX) + "\n…(truncated)";

  return json({
    markdown,
    size: markdown.length,
    generated_at: new Date().toISOString(),
    counts: {
      jobs_open: open.length,
      sentinel_24h: sentinel?.length ?? 0,
      automation_recent: automation?.length ?? 0,
      lessons_user: lUser.length,
      lessons_global: lGlobal.length,
    },
  });
}));
