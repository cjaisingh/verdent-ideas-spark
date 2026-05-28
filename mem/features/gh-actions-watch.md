---
name: GitHub Actions watcher
description: gh-actions-watch edge fn polls main-branch workflow runs every 5min; failures land in gh_actions_runs + sentinel_findings (gh_actions_main_failure, high) + Telegram; auto-resolves when newer run on main succeeds
type: feature
---

# gh-actions-watch

**Why it exists**: `ci-status-sync` only polls workflows that have an open
`discussion_action` with `ci_workflow_file` set. Failures on `main` that
aren't tied to an action go silent. This watcher is the broad net.

## Pipeline (every 5 min)

1. `GET /repos/cjaisingh/verdent-ideas-spark/actions/runs?branch=main&per_page=20`
   with `GITHUB_REVIEWS_TOKEN`.
2. For each completed run with `conclusion ∈ {failure, timed_out, startup_failure}`:
   - INSERT into `public.gh_actions_runs` (PK = `run_id`; dup → skip).
   - UPSERT `sentinel_findings` keyed on `gh_actions_run:<run_id>`,
     `kind='gh_actions_main_failure'`, `severity='high'`.
   - Send Telegram via `telegram-send` using
     `credit_settings.operator_telegram_chat_id` (same fan-out path the
     budget alerts use).
3. For the **newest completed run per workflow** with `conclusion='success'`:
   resolve every older open failure row + matching sentinel finding for
   that workflow. So a green push on `main` auto-closes the alert.

## Auth

- `x-awip-service-token` for cron + cross-project callers.
- Operator JWT for manual sweeps (`POST /` from `/admin/edge-health`).

## Schedule

`scheduled-gh-actions-watch` — `*/5 * * * *` via pg_cron + pg_net,
service-token in header (pulled from vault).

## Not in scope

- Auto-creating discussion_actions per failure (deliberate — most reds
  are transient; sentinel + Telegram is the trigger, operator decides
  whether to open an action).
- Watching non-`main` branches (would 10× the noise).
