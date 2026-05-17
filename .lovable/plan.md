
# Budget Alerts at 80% and 100% projected month-end

Sentinel check that fires once per (threshold, calendar month) when **`burn_7d_per_day × 30 / monthly_budget_credits`** crosses 80% or 100%. Surfaces in three places: in-app banner on `/admin/ai-usage`, sentinel finding (Morning Review), Telegram message.

## Trigger

```
projected_pct = round( burn_7d_per_day * 30 / monthly_budget_credits * 100, 2 )
```

Fire when `projected_pct >= 80` (level=warn) or `>= 100` (level=critical). Skipped silently if budget is null/0 or burn signal is null.

## Cadence

One alert per threshold per calendar month. State persisted in new `credit_alerts` table. Sentinel-tick (15 min) re-evaluates each run; same (year, month, threshold) row is unique → idempotent.

## Database (one migration)

### `credit_alerts`
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| year_month | text | `YYYY-MM` |
| threshold_pct | int | 80 or 100 |
| projected_pct | numeric(6,2) | snapshot at fire time |
| burn_per_day | numeric(10,2) | |
| budget | int | snapshot |
| fired_at | timestamptz | |
| acknowledged_at | timestamptz nullable | operator dismiss |
| sentinel_finding_id | uuid nullable | link |
| telegram_message_id | text nullable | for debug |
| **unique** | (year_month, threshold_pct) | enforces once-per-month |

RLS: operator-only. Realtime on (for banner auto-dismiss).

### `credit_settings` — add columns
- `operator_telegram_chat_id text` (nullable) — destination for budget alerts. Optional; if null, Telegram step is skipped.
- `alerts_enabled boolean default true` — master switch.

(Existing `alert_threshold_pct` is unused by this feature; we standardise on 80/100 hard-coded.)

## Sentinel check

`supabase/functions/sentinel-tick/checks.ts` → new `checkBudgetProjection(now, signals, settings, existingAlerts): FindingCandidate[]`.

Pure function. Returns one candidate per crossed threshold that has no row for the current `year_month`. Tested in `checks_test.ts`.

`index.ts` wiring:
1. Read `v_tool_policy_signals` + `credit_settings` + `credit_alerts` rows for current month.
2. Run `checkBudgetProjection`.
3. For each candidate:
   - Insert `sentinel_findings` (existing pattern, kind `budget_projection_80` / `budget_projection_100`).
   - Insert `credit_alerts` row with the returned `sentinel_finding_id`.
   - If `alerts_enabled` and `operator_telegram_chat_id` is set, POST to `telegram-send` with service token. Store returned `message_id` on the alert row. Failure is non-fatal.

## In-app banner

`src/components/admin/BudgetAlertBanner.tsx` (mounted at the top of `AdminAiUsage`):
- Subscribes to `credit_alerts` realtime channel + initial fetch for current month.
- Shows the most severe unacknowledged alert (100 > 80) with `projected_pct`, `burn_per_day`, budget, and a "Dismiss" button → sets `acknowledged_at = now()`.
- Critical = destructive variant; warn = amber. Toast on new insert via realtime.

## Operator settings

Two new fields in the existing `CreditsUsagePanel` Settings sheet:
- "Telegram chat ID for alerts" (text)
- "Alerts enabled" (switch)

Both write to `credit_settings`.

## Files

**New**
- `supabase/migrations/<ts>_budget_alerts.sql`
- `src/components/admin/BudgetAlertBanner.tsx`
- `docs/budget-alerts.md`
- `mem/features/budget-alerts.md`

**Edited**
- `supabase/functions/sentinel-tick/checks.ts` — add `checkBudgetProjection`
- `supabase/functions/sentinel-tick/checks_test.ts` — cases: below, crosses 80, crosses 100, already-fired-this-month, no budget, no burn
- `supabase/functions/sentinel-tick/index.ts` — wire check + insert + telegram dispatch
- `src/pages/AdminAiUsage.tsx` — mount `BudgetAlertBanner` above tabs
- `src/components/admin/CreditsUsagePanel.tsx` — extend Settings sheet (telegram chat id, alerts toggle)
- `CHANGELOG.md`, `mem://index.md`

## Out of scope

- Email channel (would need email-domain setup; you didn't pick it).
- Configurable thresholds (locked at 80/100; change in code if needed).
- Auto-pausing Lovable usage at 100% (advisory only).
- Slack (project uses Telegram).
- Alerts based on MTD actual — projection only, per your answer.
