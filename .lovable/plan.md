# Night Agent — Nightly Observation Shift

## Goal

Add a bounded "Night Agent" inside AWIP that runs **22:00–06:00 local** and exercises the jobs already in the system (Jobs board, code review, QA, test runs) without acting on them. Everything it produces is an **observation** an operator reviews in the morning. AWIP stays substrate: the Night Agent is a scheduler + recorder, not a decisioner.

## Principles (non-negotiable)

- **Read-only by default.** No writes to `roadmap_tasks`, `discussion_actions`, code, or GitHub branches outside the agent's own audit tables.
- **Fully audited.** Every shift, every job invocation, every observation has a row. Nothing happens off-book.
- **Reversible.** Because it only writes to its own tables, "rollback" = delete the shift row. No code or roadmap state to unwind.
- **GitHub + CHANGELOG aware.** The agent records the commit SHA it observed against, and the morning summary is appended to `CHANGELOG.md` under an "Overnight observations" entry.

## Shift lifecycle

```text
22:00  open_shift  → night_shifts row (status=running, commit_sha, window)
22:05  sweep jobs  → for each open discussion_action: classify risk, record finding
22:30  code review → invoke scheduled-code-review, capture summary
23:00  qa pass     → invoke qa-validate, capture summary
23:30  test run    → invoke record-test-run, capture pass/fail + failing tests
00:00  loop quiet checks every hour (lightweight)
06:00  close_shift → status=completed, write digest, append CHANGELOG entry
```

If a step errors, the shift continues; the failure is recorded as an observation, not a crash.

## Scope of observations

1. **Jobs board sweep** — for each open `discussion_actions`, the agent records a `night_observations` row tagged `job_review` with: suggested next step, risk classification (low/med/high), and (for low-risk only) a **proposed promotion** that lands in a new `night_proposals` queue. A human clicks "accept" in the morning to actually promote.
2. **Code review pass** — runs `scheduled-code-review`, stores the run id + summary as a `code_review` observation.
3. **QA pass** — runs `qa-validate`, stores result as a `qa` observation; failures get severity.
4. **Test suite** — runs `record-test-run` against current `main` SHA, stores a `tests` observation; any failing test produces a `roadmap_findings` candidate (also queued, not auto-filed).
5. **Auto-promote low-risk** — implemented as **proposals only** (`night_proposals` rows). Operator approves in the morning; only then does anything change in the Jobs board / roadmap.

## UI

Add a **Night Agent** card to `/roadmap`'s `AutomationPanel`:

- Last shift: window, commit SHA, duration, counts (`observations`, `proposals`, `failures`).
- "Open digest" → drawer listing observations grouped by type, each with a link to the underlying run.
- "Pending proposals (N)" → routes to a new `/jobs?night=pending` filter showing proposals with Accept / Reject (reuses the existing `ProposalReviewSheet`).

No new top-level route required.

## Rollback story

- Disable: flip `night_agent_enabled` in `memory_settings` → cron exits early.
- Undo a shift: delete the `night_shifts` row (cascades to observations + proposals). Nothing else changed.
- Undo an accepted proposal: it went through the normal Jobs board promotion path, so the existing audit trail (`discussion_action_events`, `roadmap_task_activity`) covers it.

## Technical details

### New tables (migration)

- `night_shifts` (id, started_at, ended_at, window_start, window_end, commit_sha, status, summary jsonb)
- `night_observations` (id, shift_id fk cascade, kind enum: `job_review|code_review|qa|tests|error`, severity, subject_ref jsonb, summary text, payload jsonb, created_at)
- `night_proposals` (id, shift_id fk cascade, source_observation_id fk, kind: `promote_job|file_finding`, target_ref jsonb, rationale text, status enum: `pending|accepted|rejected`, decided_by, decided_at)

All three: RLS operator-only, realtime enabled, indices on `shift_id` and `status`.

### Edge function

New `night-agent` edge function (verify_jwt = false, auth via `AWIP_SERVICE_TOKEN`) with two entrypoints:

- `POST /open` — creates shift, kicks off the sweep sequentially (each step has its own try/catch → observation).
- `POST /close` — finalises shift, computes digest, appends `CHANGELOG.md` entry via GitHub API using the existing repo connection, marks status=completed.

Reuses existing `scheduled-code-review`, `qa-validate`, `record-test-run` functions — does not duplicate their logic.

### Cron

Two `pg_cron` rows (via `supabase--insert`, not migrations, since they embed project URL + key):

- `0 22 * * *` → POST `/night-agent/open`
- `0 6 * * *` → POST `/night-agent/close`

Both auth with `AWIP_SERVICE_TOKEN` per existing pattern.

### CHANGELOG hook

`/close` writes a single entry like:

```text
## Overnight 2026-05-09 (commit a1b2c3d)
- 12 jobs reviewed, 3 low-risk promotion proposals queued
- Code review: 2 medium findings recorded
- QA: pass
- Tests: 1 failing (auth-flow.spec.ts) — finding candidate queued
```

via GitHub Contents API using the existing GitHub integration. If the API call fails, the digest is still in `night_shifts.summary` and a follow-up observation is recorded — the shift never blocks on GitHub.

### Memory updates

- Add `mem://features/night-agent` describing tables, cadence, and the read-only contract.
- Append a Core line: `Night Agent runs 22:00–06:00, observation-only; proposals require operator accept.`

## Out of scope (explicitly not in this plan)

- Any autonomous code edits, branch creation, or PRs.
- Auto-accepting proposals.
- Decisioning about *which* job to do first beyond a fixed risk classifier.
- A separate worker service — everything runs in `night-agent` edge function on cron.

## Acceptance

- A shift opened at 23:00 produces a `night_shifts` row, observations for all four steps, and zero writes outside the three new tables (+ the CHANGELOG append).
- Disabling `night_agent_enabled` stops the next shift cleanly.
- Deleting a `night_shifts` row removes all its observations and proposals; no orphaned state.
- `AutomationPanel` shows the last shift and a working pending-proposals link.