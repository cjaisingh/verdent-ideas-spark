# Projected spend panel

Top card on `/admin/ai-usage` → **Credits & Usage** tab. Estimates end-of-month
credit spend from rolling 14/21/30-day burn averages so you can decide weeks in
advance whether to throttle Lovable.

## Formula

```
burn_Nd_per_day = SUM(credits where occurred_at >= now() - N days) / N
projected_eom_Nd = mtd_credits + burn_Nd_per_day × days_left_in_month
projected_pct_Nd = projected_eom_Nd / monthly_budget_credits × 100
```

Manual + proxy credits are unified through `v_credit_burn_per_step` (same
source as the rest of the Credits tab).

## View

`public.v_credit_projection` (security invoker, single-row, recomputed on each
SELECT). RLS is inherited from `v_credit_burn_per_step` and `credit_settings`,
both operator-only.

## UI

- Window picker (14d / 21d / 30d) — default 21d, persisted in `localStorage`.
- Headline: MTD actual · burn/day · projected EOM · % of budget.
- Progress bar colours: green <80%, amber 80–100%, red >100%.
- Mini-comparison row shows all three windows so you can see how reactive the
  signal is.

## Relationship to budget alerts

The 80%/100% Telegram + in-app alerts in
[`budget-alerts.md`](./budget-alerts.md) intentionally use the **7d** window —
more reactive, fires earlier. This panel uses longer windows so you can sanity-
check whether the 7d signal is a blip or a trend.
