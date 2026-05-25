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

type WorkLogTask =
  | string
  | {
      task_id: string;
      summary?: string;
      issues?: string;
      fixes?: string;
      tokens_in?: number;
      tokens_out?: number;
      tokens_total?: number;
      duration_ms?: number;
      model?: string;
      model_provider?: string;
    };

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
  /**
   * Per-task work-log fan-out. Each entry creates an idempotent
   * `roadmap_work_log` row keyed on (session_id, task_id).
   * Accepts plain task_id strings for the simple case.
   */
  tasks_done?: WorkLogTask[];
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

  const row: Record<string, unknown> = {
    session_id: body.session_id,
    agent: body.agent ?? "lovable",
    started_at: startedAt,
    ended_at: endedAt,
    outcome: body.outcome ?? "",
    bootstrap_acknowledged: body.bootstrap_acknowledged ?? false,
  };
  if (body.goal !== undefined) row.goal = body.goal;
  if (body.files_touched) row.files_touched = body.files_touched;
  if (body.migrations_applied) row.migrations_applied = body.migrations_applied;
  if (body.edge_fns_touched) row.edge_fns_touched = body.edge_fns_touched;
  if (body.open_findings_at_start !== undefined) row.open_findings_at_start = body.open_findings_at_start;
  if (body.open_actions_at_start !== undefined) row.open_actions_at_start = body.open_actions_at_start;
  if (body.open_findings_at_end !== undefined) row.open_findings_at_end = body.open_findings_at_end;
  if (body.open_actions_at_end !== undefined) row.open_actions_at_end = body.open_actions_at_end;
  if (body.decisions !== undefined) row.decisions = body.decisions;
  if (body.followups !== undefined) row.followups = body.followups;
  if (body.unresolved !== undefined) row.unresolved = body.unresolved;

  const { data: summary, error: insErr } = await sb
    .from("session_summaries")
    .insert(row)
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

  // Per-task work-log fan-out. Idempotent on (session_id, task_id) via the
  // partial unique index added by the 2026-05-23 migration. We use UPSERT
  // with ignoreDuplicates so re-POSTing the same session is a no-op.
  //
  // task_id may be either a UUID (roadmap_tasks.id) or a natural key string
  // (roadmap_tasks.key, e.g. "s5.1/t3"). Non-UUID values are resolved against
  // roadmap_tasks.key in a single batched lookup. Unresolved entries land in
  // `work_log.unresolved[]` instead of failing the whole request.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const workLog = {
    attempted: 0,
    inserted: 0,
    skipped: 0,
    resolved: 0,
    unresolved: [] as string[],
    errors: [] as string[],
  };
  if (body.tasks_done?.length) {
    const normalized = body.tasks_done
      .map((t) => (typeof t === "string" ? { task_id: t } : t))
      .filter(
        (t): t is Exclude<WorkLogTask, string> =>
          !!t && typeof (t as { task_id?: unknown }).task_id === "string" &&
          (t as { task_id: string }).task_id.length > 0,
      );

    // Resolve non-UUID keys → UUIDs via roadmap_tasks.key.
    const keysToResolve = Array.from(
      new Set(normalized.filter((t) => !UUID_RE.test(t.task_id)).map((t) => t.task_id)),
    );
    const keyMap = new Map<string, string>();
    if (keysToResolve.length > 0) {
      const { data: lookups, error: lookupErr } = await sb
        .from("roadmap_tasks")
        .select("id, key")
        .in("key", keysToResolve);
      if (lookupErr) {
        workLog.errors.push(`task_key_lookup_failed: ${lookupErr.message}`);
      } else {
        for (const row of lookups ?? []) keyMap.set(row.key, row.id);
        workLog.resolved = keyMap.size;
      }
    }

    const rows: Record<string, unknown>[] = [];
    for (const t of normalized) {
      const id = UUID_RE.test(t.task_id) ? t.task_id : keyMap.get(t.task_id);
      if (!id) {
        workLog.unresolved.push(t.task_id);
        continue;
      }
      rows.push({
        session_id: body.session_id,
        task_id: id,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms:
          typeof t.duration_ms === "number"
            ? Math.round(t.duration_ms)
            : Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
        tokens_in: typeof t.tokens_in === "number" ? Math.round(t.tokens_in) : null,
        tokens_out: typeof t.tokens_out === "number" ? Math.round(t.tokens_out) : null,
        tokens_total: typeof t.tokens_total === "number" ? Math.round(t.tokens_total) : null,
        model: t.model ?? null,
        model_provider: t.model_provider ?? null,
        summary: t.summary ?? body.outcome ?? null,
        issues: t.issues ?? null,
        fixes: t.fixes ?? null,
        author: body.agent ?? "lovable",
        source: "session_summary",
      });
    }
    workLog.attempted = rows.length;
    if (rows.length > 0) {
      const { data: ins, error: wlErr } = await sb
        .from("roadmap_work_log")
        .upsert(rows, { onConflict: "session_id,task_id", ignoreDuplicates: true })
        .select("id");
      if (wlErr) {
        workLog.errors.push(wlErr.message);
      } else {
        workLog.inserted = ins?.length ?? 0;
        workLog.skipped = rows.length - workLog.inserted;
      }
    }
  }

  return json({ summary_id: summary.id, out_of_scope: oos, work_log: workLog });
}));

