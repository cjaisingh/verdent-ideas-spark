// Companion live-state helpers: fetches `companion-context` and formats it
// into a compact Markdown system message for per-turn injection.
import { supabase } from "@/integrations/supabase/client";

export type LiveState = {
  generated_at: string;
  cached?: boolean;
  built_in_ms?: number;
  lovable_focus: {
    active_tasks: Array<{ key: string; title: string; owner: string | null; module: string | null; updated_at: string }>;
    recent_changes: Array<{ task_id: string; field: string; new_value: string | null; author_label: string | null; created_at: string }>;
    last_code_review: null | {
      ran_at: string; status: string; duration_ms: number | null;
      findings: number | null; severity_counts: Record<string, number> | null;
    };
    overnight: { queued: number; running: number; last_run: null | { phase_key: string; status: string; finished_at: string | null } };
  };
  operator_queue: {
    open_actions: Array<{ short_num: number; title: string; priority: string; owner: string | null; source: string; night_eligible: boolean }>;
    deferred_due_today: Array<{ title: string; severity: string; defer_until: string }>;
    pending_approvals: number;
  };
  health: {
    last_morning_review: null | { review_date: string; stuck_jobs: unknown[]; top_actions: unknown[]; open_findings: unknown[] };
    sentinel_open: { critical: number; high: number; medium: number; low: number; info: number };
    deep_audit_latest: null | { cadence: string; status: string; finished_at: string | null; summary: Record<string, number> | null };
    automation_24h: { runs: number; failures: number };
    ai_cost_24h_usd: number;
    ai_cost_7d_usd: number;
  };
  roadmap_summary: { in_progress: number; todo: number; blocked: number; done: number };
};

export async function fetchLiveState(): Promise<LiveState | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const r = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/companion-context`,
      { method: "GET", headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.ok) return null;
    return j as LiveState;
  } catch { return null; }
}

export function formatLiveStateBlock(s: LiveState): string {
  const lf = s.lovable_focus;
  const oq = s.operator_queue;
  const h = s.health;

  const tasks = lf.active_tasks.length
    ? lf.active_tasks.map((t) => `${t.key} "${t.title}"${t.module ? ` [${t.module}]` : ""}`).join("; ")
    : "(none in_progress)";

  const cr = lf.last_code_review;
  const sev = cr?.severity_counts
    ? Object.entries(cr.severity_counts).filter(([_, n]) => n > 0).map(([k, n]) => `${n}${k[0]}`).join(" / ") || "0"
    : "n/a";
  const codeReview = cr
    ? `${new Date(cr.ran_at).toUTCString().slice(5, 22)} (${cr.status}) · ${cr.findings ?? 0} findings · ${sev}`
    : "no recent run";

  const actions = oq.open_actions.length
    ? oq.open_actions.slice(0, 5).map((a) => `#${a.short_num} ${a.priority}: ${a.title}`).join(" · ")
    : "(none)";

  const sentinel = `${h.sentinel_open.critical}C / ${h.sentinel_open.high}H / ${h.sentinel_open.medium}M`;
  const audit = h.deep_audit_latest
    ? `${h.deep_audit_latest.cadence} ${h.deep_audit_latest.status} (${h.deep_audit_latest.finished_at?.slice(0, 10) ?? "?"})`
    : "no run";

  return [
    "## AWIP live state (auto-injected — authoritative; prefer over docs for real-time questions)",
    `**Lovable is working on:** ${tasks}`,
    `- Last code-review: ${codeReview}`,
    `- Overnight: ${lf.overnight.queued} queued, ${lf.overnight.running} running${lf.overnight.last_run ? ` · last: ${lf.overnight.last_run.phase_key} (${lf.overnight.last_run.status})` : ""}`,
    `**Operator queue:** ${oq.open_actions.length} open actions · ${oq.deferred_due_today.length} deferred due today · ${oq.pending_approvals} pending approvals`,
    oq.open_actions.length ? `- Top: ${actions}` : "",
    `**Health:** Sentinel ${sentinel} · Deep audit ${audit} · Automation 24h ${h.automation_24h.runs - h.automation_24h.failures}/${h.automation_24h.runs} ok · AI spend 24h $${h.ai_cost_24h_usd} / 7d $${h.ai_cost_7d_usd}`,
    `**Roadmap:** ${s.roadmap_summary.in_progress} in-progress / ${s.roadmap_summary.todo} todo / ${s.roadmap_summary.done} done`,
    `_Snapshot at ${new Date(s.generated_at).toLocaleTimeString()}${s.cached ? " (cached)" : ""}._`,
  ].filter(Boolean).join("\n");
}

// Compact one-line summary for the header pill / quick context.
export function liveStateAge(s: LiveState | null): string {
  if (!s) return "—";
  const age = Math.round((Date.now() - new Date(s.generated_at).getTime()) / 1000);
  if (age < 60) return `${age}s`;
  return `${Math.round(age / 60)}m`;
}

// Build a richer seed for the "What is Lovable doing?" thread.
export function seedLovableFocus(s: LiveState): string {
  const lf = s.lovable_focus;
  const lines: string[] = ["## What Lovable is working on right now", ""];
  if (lf.active_tasks.length === 0) {
    lines.push("_No tasks in_progress on the roadmap._");
  } else {
    for (const t of lf.active_tasks) {
      lines.push(`- **${t.key}** — ${t.title}${t.owner ? ` · owner: ${t.owner}` : ""}${t.module ? ` · module: ${t.module}` : ""}`);
    }
  }
  lines.push("", "### Recent changes (last 10)");
  if (lf.recent_changes.length === 0) {
    lines.push("_No recent activity._");
  } else {
    for (const c of lf.recent_changes) {
      lines.push(`- \`${c.field}\` → ${(c.new_value ?? "").slice(0, 80)} (${c.author_label ?? "system"}, ${new Date(c.created_at).toLocaleString()})`);
    }
  }
  lines.push("", "### Last scheduled-code-review");
  const cr = lf.last_code_review;
  if (!cr) lines.push("_No recent run._");
  else lines.push(`- Ran ${new Date(cr.ran_at).toLocaleString()} · ${cr.status} · ${cr.findings ?? 0} findings · ${JSON.stringify(cr.severity_counts ?? {})}`);
  lines.push("", "### Overnight queue");
  lines.push(`- ${lf.overnight.queued} queued, ${lf.overnight.running} running${lf.overnight.last_run ? ` · last: ${lf.overnight.last_run.phase_key} (${lf.overnight.last_run.status})` : ""}`);
  return lines.join("\n");
}

export function seedOperatorQueue(s: LiveState): string {
  const oq = s.operator_queue;
  const h = s.health;
  const lines: string[] = ["## Operator queue review", "", "### Open discussion actions"];
  if (oq.open_actions.length === 0) lines.push("_None._");
  else for (const a of oq.open_actions) {
    lines.push(`- #${a.short_num} **${a.priority}** — ${a.title}${a.owner ? ` (owner: ${a.owner})` : ""}${a.night_eligible ? " · night-eligible" : ""}`);
  }
  lines.push("", "### Deferred items due today");
  if (oq.deferred_due_today.length === 0) lines.push("_None due._");
  else for (const d of oq.deferred_due_today) {
    lines.push(`- **${d.severity}** — ${d.title} (defer_until: ${d.defer_until})`);
  }
  lines.push("", `### Pending approvals: ${oq.pending_approvals}`);
  lines.push("", "### Open Sentinel findings");
  lines.push(`- Critical ${h.sentinel_open.critical} · High ${h.sentinel_open.high} · Medium ${h.sentinel_open.medium} · Low ${h.sentinel_open.low}`);
  if (h.deep_audit_latest) {
    lines.push("", `### Latest deep audit: ${h.deep_audit_latest.cadence} ${h.deep_audit_latest.status}`);
    if (h.deep_audit_latest.summary) lines.push(`- ${JSON.stringify(h.deep_audit_latest.summary)}`);
  }
  return lines.join("\n");
}
