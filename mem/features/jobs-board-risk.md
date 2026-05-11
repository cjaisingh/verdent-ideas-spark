---
name: jobs-board-risk
description: Risk dimension + CI auto-sync on discussion_actions. Risk gates Night Agent; ci_workflow_file links a job to a GitHub Actions workflow for status sync and optional auto-close.
type: feature
---
**Field:** `discussion_actions.risk` enum-as-text `low | med | high | critical`, default `med`. Separate from `priority` (priority = when, risk = blast radius if wrong).

**Gate:** trigger `enforce_night_eligibility_by_risk` BEFORE INSERT/UPDATE:
- `critical` → `night_eligible=false`, clears override reason. Hard no.
- `high` → `night_eligible=false` unless `night_override_reason` non-empty.
- `low`/`med` → no gate; override reason auto-cleared.

**Audit:** `discussion_action_events` types: `risk_changed`, `night_override`, `ci_status_changed`, `ci_auto_closed`.

**CI auto-sync:** edge fn `ci-status-sync` (cron `ci-status-sync-30m`, every 30 min) polls `cjaisingh/verdent-ideas-spark` GitHub Actions. Linkage columns on `discussion_actions`:
- `ci_workflow_file` (e.g. `lint-and-typecheck.yml`) — null = unlinked
- `ci_branch` (default `main`)
- `ci_close_on_success` — when true and latest run conclusion=`success`, auto sets `status='done'`
- Cached: `ci_last_status`, `ci_last_conclusion`, `ci_last_run_id`, `ci_last_run_url`, `ci_last_run_sha`, `ci_last_checked_at`

Manual: `POST /functions/v1/ci-status-sync/sync` (service token or operator JWT). Branch protection / GHAS-style checks that aren't workflows can't be linked — leave `ci_workflow_file` null and verify by separate API call.

**UI:** colored risk dot in Jobs card / Discussion Actions pane / JobDetailsDrawer. Drawer has risk select + override textarea (when `high`) + moon toggle. CI events render in the existing Activity log automatically.

**Backfill:** every existing row → `med`. Risk re-tiered as encountered. CI links wired manually as workflows are mapped.
