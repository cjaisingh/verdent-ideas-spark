// Pure helpers used by session-summary-log to fan tasks_done[] into
// roadmap_work_log rows. Extracted so we can unit-test the UUID/key resolution
// and partial-write semantics without spinning up the edge runtime.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkLogTask =
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

export type NormalisedTask = Exclude<WorkLogTask, string>;

export type BuildRowsArgs = {
  tasks: WorkLogTask[];
  /** Resolved (roadmap_tasks.key → roadmap_tasks.id) map. */
  keyMap: Map<string, string>;
  session_id: string;
  startedAt: string;
  endedAt: string;
  agent: string;
  outcome?: string;
};

export type BuildRowsResult = {
  rows: Record<string, unknown>[];
  unresolved: string[];
  /** Keys that need resolution against roadmap_tasks.key (deduped). */
  keysToResolve: string[];
};

/** Strip strings, drop empties, return objects with `task_id`. */
export function normaliseTasks(tasks: WorkLogTask[]): NormalisedTask[] {
  return tasks
    .map((t) => (typeof t === "string" ? { task_id: t } : t))
    .filter(
      (t): t is NormalisedTask =>
        !!t &&
        typeof (t as { task_id?: unknown }).task_id === "string" &&
        (t as { task_id: string }).task_id.trim().length > 0,
    )
    .map((t) => ({ ...t, task_id: t.task_id.trim() }));
}

/** Return the unique set of non-UUID task_ids that need a key lookup. */
export function collectKeysToResolve(normalised: NormalisedTask[]): string[] {
  return Array.from(
    new Set(
      normalised.filter((t) => !UUID_RE.test(t.task_id)).map((t) => t.task_id),
    ),
  );
}

/** Build the roadmap_work_log rows + record any unresolved task_ids. */
export function buildWorkLogRows(args: BuildRowsArgs): BuildRowsResult {
  const normalised = normaliseTasks(args.tasks);
  const keysToResolve = collectKeysToResolve(normalised);
  const rows: Record<string, unknown>[] = [];
  const unresolved: string[] = [];

  const startMs = new Date(args.startedAt).getTime();
  const endMs = new Date(args.endedAt).getTime();
  const fallbackDuration = Math.max(0, endMs - startMs);

  for (const t of normalised) {
    const id = UUID_RE.test(t.task_id) ? t.task_id : args.keyMap.get(t.task_id);
    if (!id) {
      unresolved.push(t.task_id);
      continue;
    }
    rows.push({
      session_id: args.session_id,
      task_id: id,
      started_at: args.startedAt,
      ended_at: args.endedAt,
      duration_ms:
        typeof t.duration_ms === "number"
          ? Math.round(t.duration_ms)
          : fallbackDuration,
      tokens_in: typeof t.tokens_in === "number" ? Math.round(t.tokens_in) : null,
      tokens_out:
        typeof t.tokens_out === "number" ? Math.round(t.tokens_out) : null,
      tokens_total:
        typeof t.tokens_total === "number" ? Math.round(t.tokens_total) : null,
      model: t.model ?? null,
      model_provider: t.model_provider ?? null,
      summary: t.summary ?? args.outcome ?? null,
      issues: t.issues ?? null,
      fixes: t.fixes ?? null,
      author: args.agent,
      source: "session_summary",
    });
  }

  return { rows, unresolved, keysToResolve };
}
