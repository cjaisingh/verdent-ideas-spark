# Automation & Operator Observability

How AWIP Core watches itself: scheduled AI code review, nightly tests, QA probes, and failure alerts. All surfaced in the **Automation** card on `/roadmap` (component: `src/components/AutomationPanel.tsx`).

## Overview

| Job | Cadence | Edge function | Writes to |
|---|---|---|---|
| AI code review | Weekly, Mon 06:00 UTC (`pg_cron`) | `scheduled-code-review` | `roadmap_review_findings` |
| Nightly tests | Nightly 02:00 UTC (GitHub Actions) | `record-test-run` | `test_runs` |
| QA probes | Weekly, Fri 16:00 UTC (`pg_cron`) | `qa-validate` | `qa_checks`, `qa_probe_results` |
| Failure alerts | On every job failure | `dispatch-alert` (helper) | `alert_log` |

All cron-invoked functions authenticate with `AWIP_SERVICE_TOKEN` (the same token used by `awip-api`). RLS on every new table is operator-only; realtime is enabled so the UI updates without polling.

## AI code review

`scheduled-code-review` pulls the last 7 days of git diff via the GitHub API and sends it to `google/gemini-2.5-pro` through the Lovable AI Gateway (no API key required). Findings are stored with severity (`high | medium | low | info`), file/line context, and the full AI message.

**UI:** click any finding row to expand the full message and related context. Filters: severity, acknowledged state, sort by newest/oldest/severity. Operators acknowledge findings to clear them from the open queue.

## Nightly tests

`.github/workflows/nightly.yml` runs `vitest run` + the e2e config at 02:00 UTC, then POSTs the summary (status, duration, counts, failing test names) to `record-test-run`. Requires the `AWIP_SERVICE_TOKEN` GitHub Actions secret (see [README](../README.md#one-time-setup)).

**UI:** per-run list with pass/fail/error status, filter by status, sort by date. Last run chip shows green/red + timestamp at the top of the card.

## QA probes

`qa_checks` holds one row per phase success criterion from `docs/master-plan.md`. `qa-validate` runs each probe:
- **Mechanical** criteria — SQL probe (e.g. "every API call logged" → `select count(*) from api_call_logs where ...`).
- **Judgement** criteria — opens a roadmap comment for the operator to tick off.

Each run writes per-criterion results to `qa_probe_results` and updates `qa_checks.status` (`pass | fail | unknown`) + `last_checked_at`.

**UI:** progress bar showing pass/fail/unknown ratio, per-check list with expand-to-detail (last note, last checked, failing probe output).

## Failure alerts

Configurable webhook (Slack/Discord-compatible) fires when any of the three jobs fail or surface significant findings. Configured in the **Alerts** card at the bottom of the Automation panel.

- `alert_settings` — one row per project: `webhook_url`, `enabled`, per-job toggles (`alert_code_review`, `alert_tests`, `alert_qa`), `dedupe_minutes` (suppress duplicate alerts within window).
- `alert_log` — every dispatch attempt: timestamp, target job, HTTP status, error message if any.
- `dispatchAlert(job, summary)` helper imported by `scheduled-code-review`, `qa-validate`, `record-test-run`. Honours dedupe + enabled flags before POSTing.
- **Send test** button POSTs a synthetic payload so operators can verify connectivity without waiting for a real failure.

### Trigger conditions

| Job | Fires when |
|---|---|
| Code review | AI gateway error, or run produced ≥1 new high-severity finding |
| Nightly tests | Run status is `failed` or `errored` |
| QA probes | Execution error, or any probe transitions to `fail` |

### Webhook payload

```json
{
  "job": "code_review" | "tests" | "qa",
  "status": "failed" | "errored" | "high_severity_finding" | "test",
  "summary": "Human-readable one-liner",
  "details_url": "https://<project>.lovable.app/roadmap",
  "occurred_at": "2026-05-06T20:55:00Z"
}
```

Slack and Discord both accept this shape via their incoming-webhook endpoints; for custom receivers, parse `job` + `status`.

## Operator workflow

1. Open `/roadmap` → **Automation** card.
2. Triage red items (failed test runs, failing QA probes, new high-severity findings).
3. Acknowledge code review findings once addressed.
4. Configure the webhook once; rotate by editing the URL in the Alerts card.

## Related docs

- [Architecture](./architecture.md) — where Automation fits in the substrate model
- [Security](./security.md) — RLS on new tables, service-token usage by cron jobs
- [Development](./development.md) — running edge functions locally, env vars
