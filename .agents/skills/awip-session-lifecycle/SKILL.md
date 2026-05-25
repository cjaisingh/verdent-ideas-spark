---
name: awip-session-lifecycle
description: Use at session start and session end on AWIP Core to load required context, log out-of-scope items via plan-footer-ingest, and POST the session summary to session-summary-log.
---

# AWIP session lifecycle

Apply this skill at the **start** and **end** of every working session on AWIP Core.

## Session start

1. Read `CONTEXT.md` (5 non-negotiable rules) and `.lovable/plan.md` (current plan + status).
2. Check `mem://index.md` Core block — always-on rules.
3. If the task touches contracts/sentinel/cron/edge-fn/agent loop, load the relevant persona from `docs/agents/team/`.
4. Note any unresolved items from the previous session (look for open `discussion_actions` with `source IN ('plan_footer','session_summary')`).

## During the session

- Any plan you write that contains an **"Out of scope"** footer MUST be POSTed to the `plan-footer-ingest` edge function so deferred items become tracked `discussion_actions` (`source='plan_footer'`).
- Anything you decide to defer **mid-flight** (not in the original plan) goes in the session summary's `out_of_scope[]` array.

## Session end

POST to `session-summary-log` with:

```json
{
  "session_id": "<uuid>",
  "started_at": "<iso>",
  "ended_at": "<iso>",
  "outcome": "<2-4 sentence recap>",
  "out_of_scope": ["item one", "item two"],
  "tasks_done": ["s5.1/t3", "s6.1/t0"]
}
```

### `tasks_done` — task_id resolution

Each entry may be a bare string OR `{ task_id, summary?, issues?, fixes?, tokens_in?, tokens_out?, tokens_total?, duration_ms?, model?, model_provider? }`.

`task_id` accepts **either**:

- a **UUID** matching `roadmap_tasks.id`, or
- a **natural key** matching `roadmap_tasks.key` (e.g. `"s5.1/t3"`, `"s6.1/t0"`).

The endpoint batch-resolves non-UUID strings via `roadmap_tasks.key` in a single lookup. **Never invent or `gen_random_uuid()` a task_id** — `roadmap_work_log.task_id` has a FK to `roadmap_tasks(id)` and a fabricated UUID will fail the insert. If a task does not yet exist in `roadmap_tasks`, create it first (or omit from `tasks_done` and capture the work in `outcome` / `out_of_scope`).

The response body carries:

```json
"work_log": {
  "attempted": 2,
  "inserted": 2,
  "skipped": 0,
  "resolved": 2,
  "unresolved": [],
  "errors": []
}
```

Inspect `unresolved[]` after every POST. Non-empty means the key/UUID was not found in `roadmap_tasks` — fix the entry or create the task and re-POST (idempotent on `(session_id, task_id)`).

Both endpoints are idempotent — re-POSTing the same `source_ref` / `(session_id, task_id)` is safe.

## Verification

- `select count(*) from discussion_actions where source in ('plan_footer','session_summary') and created_at > now() - interval '1 day';` should reflect the session's deferred items.
- `select count(*) from roadmap_work_log where session_id = '<uuid>';` should equal `work_log.inserted`.
- `sentinel_findings.kind = 'out_of_scope_stale'` will fire if deferred items sit untriaged for >14d.

## References

- `docs/session-lifecycle.md` — full contract
- `docs/out-of-scope-autolog.md` — autologger internals
- `mem://features/work-log-fanout` — per-task fan-out contract
- `mem://features/out-of-scope-autolog`
