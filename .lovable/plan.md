
# Night Agent — eligible-task pipeline with audited promotion

Tighten the Night Agent so each shift pulls a clearly-defined set of eligible jobs, runs a fixed QA pipeline against each one, writes every step to the audit trail, and only then surfaces a proposal carrying the audit summary. Read-only contract preserved: nothing is promoted without an operator click.

## Eligibility (flag AND rules)

A `discussion_actions` row is eligible for a shift when **all** of these hold:

1. `night_eligible = true` (new boolean column, default false; operator opt-in via the Jobs board).
2. `status = 'open'` and `promoted_task_id IS NULL`.
3. Risk classifier (`classifyJob`) returns `low` or `med` — `high` is excluded automatically even if the flag is set.
4. No open blocker: no other `discussion_action` references it as a parent / blocker (best-effort via `details` link or, if we add it later, a `blocked_by` column — for now: no linked roadmap task in `roadmap_tasks` with status `in_progress`).
5. Not already audited in the current shift (dedupe by `(shift_id, discussion_action_id)`).

The Jobs board gets a checkbox per row and a filter "Night-eligible only" so the operator can curate the pool during the day.

## Per-task QA pipeline

For each eligible job, the agent runs these steps **in order**, each writing a `night_observations` row tagged with `subject_ref.discussion_action_id` so we can group later:

| step | observation kind | severity rule |
|---|---|---|
| `pulled` | `job_review` | info — records risk class + eligibility snapshot |
| `global_qa` | `qa` | info on pass, high on fail — links to the shift-level `qa-validate` run |
| `code_review` | `code_review` | severity = max severity of findings whose `area` matches the job's inferred area (title keywords) |
| `tests` | `tests` | info if latest `test_runs.status = 'pass'` for the matching suite, high otherwise |
| `qa_checks` | `qa` | severity = worst status across `qa_checks` rows for the job's `phase_key` (inferred from title; falls back to `general`) |
| `audit_complete` | `job_review` | info — payload contains `{steps: 5, worst_severity, qa_passed: bool}` |

`audit_complete` is the gate marker. The view (below) only treats a job as audited when this row exists.

Global QA still runs once per shift at the start (cheap, current behaviour kept) and per-job `global_qa` references that single run rather than re-invoking it.

## Audit-complete view (no new tables)

```sql
CREATE VIEW night_task_audit AS
SELECT
  (subject_ref->>'discussion_action_id')::uuid AS discussion_action_id,
  shift_id,
  count(*) FILTER (WHERE summary LIKE 'audit_complete%') > 0 AS audit_complete,
  max(severity) AS worst_severity,
  jsonb_agg(jsonb_build_object('kind', kind, 'severity', severity, 'summary', summary) ORDER BY created_at) AS steps
FROM night_observations
WHERE subject_ref ? 'discussion_action_id'
GROUP BY shift_id, (subject_ref->>'discussion_action_id')::uuid;
```

Operator-only `SELECT`. This is what the UI and `/close` read — no new persistent table, matches the answer to "use existing observations + view".

## Proposal contract (always propose, audit attached)

After `audit_complete` is written for a job, the agent inserts exactly one `night_proposals` row:

- `kind = 'promote_job'`
- `target_ref = { discussion_action_id, short_num }`
- `rationale` = one-line summary: `"Audit: 5 steps · worst=medium · global_qa=pass · tests=pass"`
- `payload` (new column, jsonb default `{}`) carries the full step list copied from the view, so the operator sees the audit without joining anywhere.

A proposal is created **always** — including when QA fails — but the rationale + worst_severity make the failure obvious. The Accept button on the card is disabled (with a tooltip) when `worst_severity = 'high'`; the operator can still force-accept via a confirm modal. Reject is always available.

## Promotion writes back to the audit trail

When the operator accepts a proposal:

1. Existing flow: `discussion_actions.promoted_task_id` set → `discussion_action_events` row written by trigger.
2. New: a final `night_observations` row `kind='job_review'`, `summary='promoted'`, payload `{ proposal_id, decided_by }` so the morning digest reads end-to-end without context-switching.

Rejection logs a parallel `summary='rejected'` observation.

## UI changes (frontend only)

- `JobsBoard` row: new `Night-eligible` checkbox + filter chip. Reads/writes `night_eligible`.
- `NightAgentCard` proposals list: each row shows the rationale string, a colored severity dot (green/amber/red), and "View audit" expand revealing the `steps` array. Accept disabled for red unless confirmed.
- New `/jobs?night=pending` deep link from the card.

## Technical details

### Migration

```sql
ALTER TABLE discussion_actions ADD COLUMN night_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE night_proposals ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE VIEW night_task_audit AS ...;  -- as above, with operator-only grant
```

No new tables.

### `night-agent` edge function changes

`/open` becomes:

```text
1. create shift (unchanged)
2. invoke qa-validate once → store run id in shift.summary
3. select eligible jobs (flag + rules)
4. for each job (sequential, bounded to 50/shift):
     write 'pulled'
     write 'global_qa' referencing step 2
     fetch latest review findings overlapping job.area → write 'code_review'
     fetch latest test_runs for inferred suite → write 'tests'
     snapshot qa_checks for inferred phase → write 'qa_checks'
     write 'audit_complete' with worst_severity rolled up
     insert night_proposals row with rationale + payload
5. return { jobs_audited, proposals_queued, failures }
```

`classifyJob` extended to return reason string for the audit (logged in `pulled` payload).

`/close` adds `audit_summary` to `night_shifts.summary` by reading `night_task_audit` for that shift.

### Tests / smoke

Manual smoke after deploy: hit `/open` with one flagged low-risk job, expect 5 observations + 1 proposal with rationale; flip the test_run to fail, re-run, expect rationale to flip to red and Accept disabled.

## Memory updates

- Update `mem://features/night-agent` with the eligibility rules, pipeline order, and the `night_task_audit` view.
- Append a Core line: `Night Agent only audits jobs with night_eligible=true; every promotion preceded by an audit_complete observation.`

## Out of scope

- Auto-acceptance of proposals (still operator-only).
- Inferring `phase_key` / `area` more cleverly than keyword match (good enough v1).
- Per-job parallelism (sequential keeps shifts boring and easy to debug).
- New tables — view-only by design.

## Acceptance

- A flagged low-risk open job produces exactly 5 observations + 1 audit_complete + 1 proposal per shift.
- A flagged high-risk job is excluded; an audit-complete observation is **never** written for it.
- `night_task_audit` returns `audit_complete = true` only when all 5 steps + the marker are present.
- Accepting a proposal writes the trailing `promoted` observation; deleting the shift cascades everything.
- Operator can disable the whole feature with `memory_settings.night_agent_enabled = false` (existing kill switch).
