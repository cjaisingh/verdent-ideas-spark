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

Every alert POSTs the same JSON body to `alert_settings.webhook_url`:

```json
{
  "text": "🚨 scheduled-code-review · high_finding\n3 new high-severity findings in this run",
  "job": "scheduled-code-review",
  "reason": "high_finding",
  "message": "3 new high-severity findings in this run",
  "payload": { "run_id": "…", "count": 3 },
  "ts": "2026-05-06T20:55:00.000Z"
}
```

Field reference:

| Field | Values | Notes |
|---|---|---|
| `text` | string | Pre-formatted one-liner. Slack and Discord render this directly. |
| `job` | `scheduled-code-review` \| `qa-validate` \| `record-test-run` | Source edge function. |
| `reason` | `review_error` \| `high_finding` \| `qa_fail` \| `test_fail` \| `test` | `test` is the synthetic payload from the **Send test** button. Mapped to per-job toggles via `alert_on_review_error`, `alert_on_high_finding`, `alert_on_qa_fail`, `alert_on_test_fail`. |
| `message` | string | Human-readable detail (e.g. failing test names, probe id). |
| `payload` | object | Job-specific context (run id, finding ids, probe results). Schema is best-effort, not stable. |
| `ts` | ISO 8601 | Dispatch time. |

#### Slack incoming webhook

No transformation needed — Slack uses the top-level `text` field. Drop the URL from **Slack → Apps → Incoming Webhooks → Add to channel** straight into the Alerts card.

```
https://hooks.slack.com/services/T000/B000/XXXX
```

For richer formatting (blocks, attachments), terminate the webhook at a small relay that re-shapes `payload` into Block Kit before forwarding.

#### Discord incoming webhook

Discord also reads top-level `content`/`text` differently — it expects `content`. The current dispatcher sends `text`, which Discord ignores, so for Discord use a relay or append `/slack` to the Discord webhook URL to enable Slack-compatible mode:

```
https://discord.com/api/webhooks/123/abc/slack
```

With `/slack` appended, Discord reads the `text` field directly and the alert renders in-channel with no extra work.

#### Custom receiver

Any HTTPS endpoint that returns 2xx counts as delivered. Parse `job` + `reason` to route, use `payload` for structured detail. Minimal Node example:

```ts
// POST /awip-alerts
app.post("/awip-alerts", async (req, res) => {
  const { job, reason, message, payload, ts } = req.body;
  if (reason === "test") return res.sendStatus(204);

  switch (job) {
    case "scheduled-code-review":
      await pageOnCall({ title: `Code review: ${reason}`, body: message, meta: payload });
      break;
    case "record-test-run":
      await openIncident({ severity: "P3", summary: message, ts });
      break;
    case "qa-validate":
      await notifyChannel("#qa", `${message} (${payload?.probe_id ?? "n/a"})`);
      break;
  }
  res.sendStatus(202);
});
```

Delivery outcome (status code, error body, `delivered` flag) is recorded in `alert_log` and shown in the Alerts card. Non-2xx responses surface as red rows so you can debug receiver issues without leaving the operator UI.


## Operator workflow

1. Open `/roadmap` → **Automation** card.
2. Triage red items (failed test runs, failing QA probes, new high-severity findings).
3. Acknowledge code review findings once addressed.
4. Configure the webhook once; rotate by editing the URL in the Alerts card.

## Related docs

- [Architecture](./architecture.md) — where Automation fits in the substrate model
- [Security](./security.md) — RLS on new tables, service-token usage by cron jobs
- [Development](./development.md) — running edge functions locally, env vars
