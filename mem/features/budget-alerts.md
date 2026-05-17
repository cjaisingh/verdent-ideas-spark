---
name: Budget alerts
description: 80%/100% projected month-end credit spend alerts; sentinel-tick check + credit_alerts table + in-app banner + Telegram
type: feature
---

Projection-based budget alerts (forward-looking, not MTD).

- Signal: `burn_7d_per_day × 30 / monthly_budget_credits × 100` via `v_tool_policy_signals`.
- Check: `checkBudgetProjection` in `supabase/functions/sentinel-tick/checks.ts`. Pure function, 8 tests.
- Cadence: every sentinel-tick (15 min). Once per `(year_month, threshold_pct)` enforced by unique index on `credit_alerts`.
- Thresholds: **hard-coded 80 (high) and 100 (critical)**. The legacy `credit_settings.alert_threshold_pct` only tints the Credits KPI card.
- Surfaces:
  - `credit_alerts` table (operator RLS, realtime).
  - `sentinel_findings` kinds `budget_projection_80` / `budget_projection_100` (rolled into Morning Review).
  - `BudgetAlertBanner` on /admin/ai-usage — most severe unacknowledged alert for current month; dismiss sets `acknowledged_at`.
  - Telegram via `telegram-send` (service token) — only if `credit_settings.alerts_enabled` and `operator_telegram_chat_id` set. Failure is non-fatal.
- Settings extended on `credit_settings`: `operator_telegram_chat_id`, `alerts_enabled`. Edited in Credits & Usage → Settings sheet.

**Why:** the operator spent £600 and needed a forward-looking signal to decide whether to switch to Claude Max (£200 flat). MTD-based alerts fire too late.
