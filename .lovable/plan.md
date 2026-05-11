## Plan: Auto-update jobs board from GitHub workflow results

**1. Schema (migration)** — add CI linkage columns to `discussion_actions`:
- `ci_workflow_file text` (e.g. `lint-and-typecheck.yml`) — null = no link
- `ci_branch text default 'main'`
- `ci_close_on_success boolean default false` — opt-in auto-close
- `ci_last_status text`, `ci_last_conclusion text`, `ci_last_run_id bigint`, `ci_last_run_url text`, `ci_last_checked_at timestamptz`
- `ci_last_run_sha text`
- Index on `(ci_workflow_file) where ci_workflow_file is not null and status='open'`

Trigger extension: emit `ci_status_changed` and `ci_auto_closed` events into `discussion_action_events`.

**2. Edge function `ci-status-sync`** (wrapped with `withLogger`):
- Auth: `x-awip-service-token` (cron) or operator JWT
- Loops every open action with `ci_workflow_file != null`
- Polls `GET /repos/cjaisingh/verdent-ideas-spark/actions/workflows/{file}/runs?branch={branch}&per_page=1`
- Updates the `ci_*` columns; if conclusion=`success` and `ci_close_on_success=true`, sets `status='done'` and inserts a `ci_auto_closed` event
- Returns `{ checked, updated, auto_closed }` summary

**3. Cron** — pg_cron every 30 min via `supabase--insert` (anon key + service token, follows existing pattern). Job name: `ci-status-sync-30m`.

**4. Backfill links** — wire the obvious open jobs to their workflows:
- `#594fb59b` "Lint regression" → `lint-and-typecheck.yml`, `ci_close_on_success=true`
- `#bf7df716` "Unverified Branch Protection" — no workflow; leave unlinked (it's a GitHub settings check, handled separately later)
- Also link `#ee7937ce` "Replace ~480 no-explicit-any" → `lint-and-typecheck.yml` but `ci_close_on_success=false` (just track status, not auto-close — closure needs human review)

**5. Surface (minimal)** — `JobDetailsDrawer.tsx` already shows the activity log; `ci_status_changed` events render automatically. No new UI.

**6. Docs + memory** — `docs/jobs-board.md` gets a new section "CI auto-sync"; mem entry under `mem://features/jobs-board-risk` updated with the linkage convention.

Risk: `low`. Read-only on GitHub side; only writes are status updates on rows that explicitly opt in via `ci_close_on_success`. Safe to night-shift if ever needed.