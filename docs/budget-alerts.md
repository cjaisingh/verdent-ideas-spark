# Budget alerts

Forward-looking alerts that fire when **projected month-end spend** crosses
**80%** or **100%** of `credit_settings.monthly_budget_credits`.

## Signal

```
projected_pct = burn_7d_per_day × 30 / monthly_budget_credits × 100
```

Source: view `v_tool_policy_signals` (built on `v_credit_burn_per_step`).

Skipped silently when budget is null/0 or burn rate is null/0.

## Cadence

- Evaluated every `scheduled-sentinel-tick` run (15 min).
- One alert per `(year_month, threshold_pct)` — enforced by a unique index on
  `credit_alerts`.
- Crossing 100% without ever crossing 80% in the same month inserts both
  rows in a single tick.

## Surfaces

1. **In-app banner** — `BudgetAlertBanner` mounted at the top of
   `/admin/ai-usage`. Subscribes to `credit_alerts` realtime. Shows the most
   severe unacknowledged alert for the current month; dismiss writes
   `acknowledged_at`.
2. **Sentinel finding** — kind `budget_projection_80` (high) or
   `budget_projection_100` (critical). Rolls into Morning Review like any
   other finding.
3. **Telegram** — fires only if `credit_settings.alerts_enabled = true`
   **and** `credit_settings.operator_telegram_chat_id` is set. Uses the
   existing `telegram-send` edge function via service token. Failure is
   non-fatal; the row + finding still land.

## Tables

### `credit_alerts`

| col | type | notes |
|---|---|---|
| year_month | text | `YYYY-MM` (UTC) |
| threshold_pct | int | 80 or 100 |
| projected_pct | numeric(6,2) | snapshot at fire time |
| burn_per_day | numeric(10,2) | snapshot |
| budget | int | snapshot |
| fired_at | timestamptz | default now() |
| acknowledged_at | timestamptz | nullable; dismiss timestamp |
| sentinel_finding_id | uuid | nullable link |
| telegram_message_id | text | nullable, for debug |
| **unique** | (year_month, threshold_pct) | |

RLS: operator-only (read/write/update/delete). Realtime enabled.

### `credit_settings` — new columns

- `operator_telegram_chat_id text` — destination for Telegram alerts.
- `alerts_enabled boolean default true` — master switch.

Both editable from **/admin/ai-usage → Credits & Usage → Settings**.

## Why projection only, not MTD

You asked for projection only. MTD fires after you've already overspent;
projection at 80% gives you ~6 days of warning at typical burn rates.

## Out of scope

- Email channel (would need email domain).
- Auto-pausing Lovable usage at 100% — advisory only.
- User-configurable thresholds — locked at 80/100. Change in
  `checks.ts → checkBudgetProjection`.

## Files

- `supabase/functions/sentinel-tick/checks.ts` — `checkBudgetProjection`
- `supabase/functions/sentinel-tick/checks_test.ts` — 8 tests
- `supabase/functions/sentinel-tick/index.ts` — wire + telegram + insert
- `src/components/admin/BudgetAlertBanner.tsx`
- `src/components/admin/CreditsUsagePanel.tsx` — settings extension
- `src/pages/AdminAiUsage.tsx` — mount banner
