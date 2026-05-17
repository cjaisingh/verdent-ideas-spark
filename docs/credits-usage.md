# Credits & Usage

Operator-only tab on `/admin/ai-usage` that tracks Lovable credit burn per build step.

## Why this exists

Lovable does not expose its credit-billing API to your project, so the dashboard cannot read your real credit balance automatically. This tab gives you three complementary signals:

- **Manual ledger** — per-step entries you log yourself. Real credits.
- **Token proxy** — derived from `roadmap_work_log.tokens_total` × a configurable rate. Trend signal, not a real number.
- **Balance snapshots** — operator-entered readings of your remaining Lovable credits, optionally tagged with the closing phase. Drives true days-of-runway.

## Data model

| Object | Purpose |
|---|---|
| `credit_entries` | Manual ledger. One row per operator-logged step. |
| `credit_settings` | Singleton: `proxy_rate_per_1k_tokens`, `monthly_budget_credits`, `alert_threshold_pct`. |
| `credit_balance_snapshots` | Operator-entered remaining balance + optional `phase_id`, `source`, `note`. |
| `v_credit_burn_per_step` | Unioned feed (manual + proxy). |
| `v_credit_burn_per_phase_30d` | Per-phase rollup, last 30 days. |
| `v_credit_balance_latest` | Most recent snapshot. |
| `v_credit_runway` | Estimated balance now + days-of-runway (7d / 21d burn). |
| `v_credit_phase_deltas` | Per closed phase: opening/closing balance, delta, logged spend, unaccounted drift. |
| `v_phases_awaiting_balance` | Phases marked done in last 14d with no snapshot — drives the end-of-phase prompt. |

All access is operator-only (`has_role(auth.uid(), 'operator')`).

## Balance, runway, per-phase deltas

The runway block inside the Projected Spend panel uses your most recent snapshot:

- `estimated_balance_now = balance − sum(burn since as_of)`
- `days_runway_21d = estimated_balance_now / burn_per_day_21d`
- Tone: green ≥14d, amber 7–14d, red <7d. Stale-banner when the reading is over 7 days old.

**End-of-phase prompt.** Whenever a phase flips to `done`, it appears in the amber **Phases awaiting balance snapshot** panel at the top of the tab until you record a closing balance against it. Each snapshot tagged with `phase_id` becomes the closing reading in `v_credit_phase_deltas`, which compares it to the previous snapshot (opening) and the logged spend for that phase — surfacing how much credit drift was *not* in the manual ledger.

## Operating the dashboard

- **Log a step**: click "Log credits", pick (optional) task, name the step, enter credits actually spent. Show up immediately in the table and roll into MTD totals.
- **Tune the proxy**: open Settings → adjust `proxy rate`. Default `0.05` credits per 1k tokens is a rough placeholder. Set to `0` to hide the proxy series entirely.
- **Budget alerts**: set `monthly_budget_credits` and `alert_threshold_pct`. When MTD total ≥ threshold, the Budget KPI turns amber.

## Limitations (and what's not built)

- No auto-import from Lovable billing — manual or proxy only.
- No webhook on budget breach. Wire one later via the existing `automation_jobs` pattern if needed.
- Historical backfill not done. Past `roadmap_work_log` rows with tokens automatically contribute via the proxy; manual entries only count from creation forward.
