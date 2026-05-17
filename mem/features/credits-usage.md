---
name: credits-usage
description: Track Lovable credit burn per build step. Manual ledger + token proxy from roadmap_work_log. Tab on /admin/ai-usage.
type: feature
---

**Surface:** "Credits & Usage" tab on `/admin/ai-usage`.

**Tables:**
- `credit_entries` — operator-logged real credit spend (task_id, phase_id, step_label, credits, mode, note, occurred_at). Operator-only RLS. Realtime on.
- `credit_settings` — singleton (id=true) with `proxy_rate_per_1k_tokens` (default 0.05), `monthly_budget_credits` (nullable), `alert_threshold_pct` (default 80).

**Views (SECURITY INVOKER):**
- `v_credit_burn_per_step` — unions manual entries + proxy rows derived from `roadmap_work_log` where `tokens_total > 0`. Proxy credits = `tokens_total / 1000 × proxy_rate_per_1k_tokens`.
- `v_credit_burn_per_phase_30d` — rollup by phase over last 30d with `manual_credits`, `proxy_credits`, `total_credits`.
- `v_credit_projection` — single row: MTD actual + 14/21/30d burn/day + projected EOM + % of budget. Powers `ProjectedSpendPanel` at top of the tab. Linear extrapolation only; 21d window is the default. Budget alerts still use 7d (more reactive).

**UI:** banner explaining manual vs proxy, 4 KPIs (MTD manual / proxy / total / budget %), Recharts line trend (manual + proxy series), per-phase table, per-step table (manual=primary chip, proxy=secondary chip). "Log credits" dialog + Settings sheet.

**Honest constraint:** Lovable has no billing API exposed to the project. Proxy is a *signal*, not a real credit number. Set `proxy_rate_per_1k_tokens = 0` to collapse the proxy series.

**Out of scope:** CSV import from Lovable billing export, Slack/Telegram budget breach webhook, historical backfill.
