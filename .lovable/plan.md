## Projected spend panel

A new card at the top of the **Credits & Usage** tab on `/admin/ai-usage` that estimates end-of-month credit spend from rolling 14/21/30-day windows, so you can decide weeks in advance whether to throttle Lovable.

### What it shows

One card with:

- **MTD actual** — sum of `credit_entries.credits` for current `year_month` (manual + proxy, split).
- **Daily burn** — three rolling averages: last 14d, 21d, 30d (manual + proxy combined).
- **Projected EOM** — for each window: `mtd + burn_per_day × days_left_in_month`. Default highlighted window: 21d.
- **% of monthly budget** — projected EOM ÷ `credit_settings.monthly_budget_credits`, with a progress bar coloured green (<80%), amber (80–100%), red (>100%).
- **Headroom** — `budget − projected_eom`, signed.
- **Window picker** — segmented control (14d / 21d / 30d) that changes which projection drives the headline + progress bar. Persists in `localStorage`.
- **Footnote** — "Projection assumes current burn continues. Real number is unknowable — Lovable has no billing API." Plus a link to `docs/budget-alerts.md` and a note saying the 80%/100% alerts use the 7d window (intentionally more reactive).

### Where

`src/components/admin/ProjectedSpendPanel.tsx`, mounted at the top of the existing `CreditsUsagePanel` (above the existing "By phase / 30d" and "Recent entries" tables). No new route, no new tab.

### Data

New read-only SQL view `public.v_credit_projection` with one row containing:

```text
year_month, mtd_credits, mtd_manual, mtd_proxy,
burn_14d_per_day, burn_21d_per_day, burn_30d_per_day,
days_in_month, days_elapsed, days_left,
projected_eom_14d, projected_eom_21d, projected_eom_30d,
budget, projected_pct_14d, projected_pct_21d, projected_pct_30d
```

Computed from `credit_entries` (sum credits per window / N) and `credit_settings.monthly_budget_credits`. Operator-only RLS via `has_role(auth.uid(),'admin')`.

No new table, no cron, no edge function — the view is recomputed on each `SELECT`. Budget-alert logic and the existing `v_credit_burn_per_step` / `v_credit_burn_per_phase_30d` views are untouched.

### Files

- **New migration**: `v_credit_projection` view + RLS.
- **New**: `src/components/admin/ProjectedSpendPanel.tsx`.
- **Edit**: `src/components/admin/CreditsUsagePanel.tsx` — mount the panel at the top of its content.
- **Edit**: `CHANGELOG.md`, `docs/credits-usage.md` (append section), `mem://features/credits-usage` (note the new view).

### Out of scope

- New alert thresholds (existing 80/100% alerts cover this).
- Forecasting models beyond linear extrapolation (no day-of-week weighting, no exponential smoothing).
- Per-phase or per-tool projection — overall only.
- Editing the projection window default from a UI (hardcoded to 21d; user-selectable per-session via the segmented control).
