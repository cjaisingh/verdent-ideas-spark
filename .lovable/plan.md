## Why this slipped

`ci-status-sync` only polls workflows that are linked to an **open `discussion_action`** with `ci_workflow_file` set. The 17:12 UTC failures on `857c666` (Lint & Typecheck + CI) are on `main` but no action is linked, so the cron literally has nothing to look at. Result: red emails, silent dashboard.

Two things to fix:

### 1. Stop the bleeding — fix the 4 files that errored

Real error-level violations (not in `.lint-baselines/no-explicit-any.json`):

- `src/components/timeline/TimelineNowChip.tsx` — 3 `any` casts on `(supabase as any)` / row types
- `src/pages/AdminTimeline.tsx` — new `any`s
- `src/pages/SentinelPerf.tsx` — new `any`s
- `supabase/functions/_shared/out-of-scope_test.ts` — test fixtures using `any`

Action: replace `any` with proper types (the supabase view rows already have local type aliases like `P95Row` / `SentinelPerfRow` — extend that pattern). No baseline edits; the policy is "fix, don't widen".

### 2. Add the missing watcher — `gh-actions-watch`

So the **next** red on `main` lights up the dashboard before the email does.

**New edge function** `gh-actions-watch` (wrapped with `withLogger`, `verify_jwt=false`, service-token auth):

- Polls `GET /repos/cjaisingh/verdent-ideas-spark/actions/runs?branch=main&per_page=20` every 5 min via cron.
- For each workflow run that `completed` with `conclusion in ('failure','timed_out','startup_failure')` and is newer than `gh_actions_runs.last_seen_at`:
  - upsert into new `public.gh_actions_runs` table (`run_id PK, workflow, branch, sha, conclusion, html_url, run_started_at, seen_at`)
  - emit a `sentinel_findings` row (`check_key='gh_actions_main_failure'`, severity `high`, dedupe key `run_id`)
  - fire Telegram via existing `telegram-send` with workflow name + sha + run URL
- Auto-resolves the finding when a later run on `main` for the same workflow file concludes `success`.

**Sentinel surface**: add `gh_actions_main_failure` to the registry so it shows on `/admin/sentinel`, `/admin/edge-health`, and Morning Review.

**Cron**: `scheduled-gh-actions-watch` every 5 minutes, service-token auth.

### Migration

```sql
CREATE TABLE public.gh_actions_runs (
  run_id bigint PRIMARY KEY,
  workflow text NOT NULL,
  branch text NOT NULL,
  sha text NOT NULL,
  conclusion text NOT NULL,
  html_url text NOT NULL,
  run_started_at timestamptz NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT ON public.gh_actions_runs TO authenticated;
GRANT ALL ON public.gh_actions_runs TO service_role;
ALTER TABLE public.gh_actions_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read gh runs" ON public.gh_actions_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'operator'));
CREATE INDEX gh_actions_runs_workflow_started_idx
  ON public.gh_actions_runs(workflow, run_started_at DESC);
```

### Docs / memory

- `docs/ci-cd.md` § new "GitHub Actions watcher"
- `mem/features/gh-actions-watch.md` (new) + add to `mem://index.md` Core: "main-branch GH Actions failures land in sentinel within 5min via `gh-actions-watch`"

### Out of scope

- Branch protection enforcement (still operator action — see ci-cd-hardening memory)
- Re-enabling CodeQL (explicitly disabled, requires triage owner)
- Auto-fixing lint by widening the baseline — we fix `any`s instead
