# Credits & Usage

Operator-only tab on `/admin/ai-usage` that tracks Lovable credit burn per build step.

## Why this exists

Lovable does not expose its credit-billing API to your project, so the dashboard cannot read your real credit balance automatically. This tab gives you two complementary signals:

- **Manual** — entries you log yourself after each build step. These are real credits.
- **Proxy** — derived from `roadmap_work_log.tokens_total` × a configurable rate (credits per 1k tokens). This is a *trend signal*, not a real number. Calibrate the rate against your billing once you have enough manual data to compare.

## Data model

| Object | Purpose |
|---|---|
| `credit_entries` | Manual ledger. One row per operator-logged step. |
| `credit_settings` | Singleton: `proxy_rate_per_1k_tokens`, `monthly_budget_credits`, `alert_threshold_pct`. |
| `v_credit_burn_per_step` | Unioned feed (manual + proxy). |
| `v_credit_burn_per_phase_30d` | Per-phase rollup, last 30 days. |

All access is operator-only (`has_role(auth.uid(), 'operator')`).

## Operating the dashboard

- **Log a step**: click "Log credits", pick (optional) task, name the step, enter credits actually spent. Show up immediately in the table and roll into MTD totals.
- **Tune the proxy**: open Settings → adjust `proxy rate`. Default `0.05` credits per 1k tokens is a rough placeholder. Set to `0` to hide the proxy series entirely.
- **Budget alerts**: set `monthly_budget_credits` and `alert_threshold_pct`. When MTD total ≥ threshold, the Budget KPI turns amber.

## Limitations (and what's not built)

- No auto-import from Lovable billing — manual or proxy only.
- No webhook on budget breach. Wire one later via the existing `automation_jobs` pattern if needed.
- Historical backfill not done. Past `roadmap_work_log` rows with tokens automatically contribute via the proxy; manual entries only count from creation forward.
