---
name: Work-log fan-out from session-summary-log
description: tasks_done[] on session-summary-log writes idempotent roadmap_work_log rows keyed on (session_id, task_id). Restores per-task AI attribution for Credits/Usage, scheduled-code-review, daily-plan, and the work_log_recent QA probe.
type: feature
---

# Work-log fan-out

Per-task AI attribution lives in `roadmap_work_log`. Before 2026-05-23 it was empty in practice — operators rarely logged manually and `session-summary-log` only wrote to `session_summaries`. The Phase 2 QA probe `work_log_recent` went red, Credits/Usage proxy showed flat, and `scheduled-code-review` + `daily-plan` had nothing to read.

## Contract

`POST /session-summary-log` now accepts:

```ts
tasks_done?: Array<
  | string  // bare task_id; fills tokens with null, summary with body.outcome
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
    }
>
```

Each entry upserts a `roadmap_work_log` row with:
- `session_id` = body.session_id
- `source` = `'session_summary'`
- `author` = body.agent ?? `'lovable'`
- `started_at` / `ended_at` = body.started_at / body.ended_at
- `duration_ms` = explicit or derived from start/end

Response carries `work_log: { attempted, inserted, skipped, errors }`.

## Idempotency

Unique index `roadmap_work_log_session_task_uniq` on `(session_id, task_id)`. UPSERT with `ignoreDuplicates: true` — re-POSTing the same session is a no-op. Manual rows (NULL `session_id`) are unaffected; NULLs are distinct in PG btree uniqueness, so multiple manual entries against the same task still coexist.

## Consumers

- `v_credit_burn_per_step` — token×rate proxy on `roadmap_work_log.tokens_total`
- `scheduled-code-review` — reads recent rows for "what changed this week"
- `daily-plan` — reads recent rows for the morning roll-up
- `qa-validate.work_log_recent` probe — passes if `roadmap_work_log` OR `session_summaries` has activity in last 7d (the OR is keep-the-lights-on; once fan-out is the norm, `roadmap_work_log` carries it alone)

## Operator habit (option 2 of the oversight thread)

`/morning-review` → Tomorrow tab IS the daily contract — list 3-5 tasks each morning, evening review checks what shipped. The fan-out is the backward-looking truth; Tomorrow Plan is the forward-looking control.

## References

- `supabase/functions/session-summary-log/index.ts`
- Migration: `roadmap_work_log_session_task_uniq` (2026-05-23)
- `docs/session-lifecycle.md` § Session end
- `mem://features/credits-usage`
