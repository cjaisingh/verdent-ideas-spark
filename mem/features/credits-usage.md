---
name: credits-usage
description: Track Lovable credit burn per build step. Manual ledger + token proxy from roadmap_work_log. Tab on /admin/ai-usage.
type: feature
---

**Surface:** "Credits & Usage" tab on `/admin/ai-usage`.

**Tables:**
- `credit_entries` — operator-logged real credit spend (task_id, phase_id, step_label, credits, mode, note, occurred_at). Operator-only RLS. Realtime on.
- `credit_settings` — singleton (id=true) with `proxy_rate_per_1k_tokens` (default 0.05), `monthly_budget_credits` (nullable), `alert_threshold_pct` (default 80).
- `credit_balance_snapshots` — operator-entered remaining-credit readings (`balance_credits`, `as_of`, `phase_id?`, `source?`, `note?`, `label?`, `subject_type?`, `subject_id?`). Optional `phase_id` tags it as the closing reading for that phase. `subject_type` in `roadmap_phase|discussion_action|roadmap_task|dev_turn|manual` auto-filled by `fill_credit_snapshot_subject` trigger from `phase_id` if absent. Operator-only RLS + realtime.

**Views (SECURITY INVOKER):**
- `v_credit_burn_per_step` — unions manual entries + proxy rows derived from `roadmap_work_log` where `tokens_total > 0`. Proxy credits = `tokens_total / 1000 × proxy_rate_per_1k_tokens`. Carries `category` column (manual rows only; proxy rows NULL).
- `v_credit_burn_per_phase_30d` — rollup by phase over last 30d with `manual_credits`, `proxy_credits`, `total_credits`.
- `v_credit_projection` — single row: MTD actual + 14/21/30d burn/day + projected EOM + % of budget. Powers `ProjectedSpendPanel` at top of the tab. Linear extrapolation only; 21d window is the default. Budget alerts still use 7d (more reactive).
- `v_credit_spend_by_category` — per-`work_category` MTD + 30d totals and share %. Powers `SpendByCategoryPanel` (bar + table, click to filter per-step table). Proxy rows excluded (no category).
- `v_credit_balance_latest` / `v_credit_runway` / `v_credit_phase_deltas` / `v_phases_awaiting_balance` — drive runway block in `ProjectedSpendPanel`, `BalanceHistoryPanel`, `PhaseDeltasPanel`, `PhasesAwaitingBalancePanel`.
- `v_credit_snapshot_deltas` / `v_credit_snapshot_latest_age` — per-snapshot Δ vs logged spend with `drift_band` (match/over-logged/under-logged/no-logged); latest-age view powers `BalanceTrackingPanel` header + `credit_snapshot_stale` sentinel.
- `v_credit_drift_ratio_overall` / `v_credit_drift_ratio_by_category` — last 8 closed phases with opening+closing snapshots; `drift_ratio = actual_total/logged_total`; confidence `high`(≥6)/`medium`(3-5)/`low`. Per-category attribution is share-of-logged-spend weighted.

**Categories:** `work_category` enum (`plan`/`build`/`pivot`/`refactor`/`bugfix`/`research`/`ops`/`other`) on `credit_entries` (default `build`). Orthogonal to `mode`. Optional `roadmap_tasks.default_category` pre-fills the dialog.

**UI:** banner explaining manual vs proxy, 4 KPIs, Recharts trend, per-phase + per-step tables. `ProjectedSpendPanel` shows Adjusted ×N.NN pill when drift ratio is medium/high confidence (toggleable, persists in localStorage as `awip.projectedSpend.driftAdjust`). `SpendByCategoryPanel` has a Drift column. `/admin/ai-usage?phase=<id>&prompt=balance` auto-opens `BalanceSnapshotDialog`.

**End-of-phase auto-prompt:** trigger `trg_phase_close_balance_prompt` on `roadmap_phases AFTER UPDATE OF status` inserts an idempotent `discussion_actions` row (`source=auto-credit-prompt`, `subject_type=roadmap_phase`, `night_eligible=true`, `morning_review_panel_ref=credits`) when status flips to `done`. `trg_resolve_balance_prompt` auto-closes it on snapshot insert. `PhasesAwaitingBalancePanel` is the fallback view.

**Runway alert:** sentinel-tick `checkCreditRunway` reads `v_credit_runway`. Fires `credit_runway_warn` (high, <14d) and `credit_runway_critical` (critical, <7d) once per (year_month, kind). Skips stale (>7d) snapshots and zero burn. `credit_alerts.kind` is the dedupe key (replaces old `threshold_pct` unique key).

**Snapshot staleness alert:** `checkCreditSnapshotStale` reads `v_credit_snapshot_latest_age`. Fires `credit_snapshot_stale_warn` (high, >4h + ≥3 entries) and `credit_snapshot_stale_critical` (critical, >24h + ≥1 entry) once per UTC day. Dedup keys `credit_snapshot_stale_{warn,critical}:YYYY-MM-DD`.

**Per-snapshot UI:** `BalanceTrackingPanel` (above `BalanceHistoryPanel`) — header shows latest snapshot age + entries since + 24h snapshot count, warns when stale. Table of last 20 deltas with Δ spent, logged-in-window, drift chip; click row → drawer of matching `credit_entries`. `BalanceHistoryPanel` gains Drift column. Dialog gains free-form `label` + "Link to discussion_action/roadmap_task" picker (when no phase preset).

**Honest constraint:** Lovable has no billing API. Proxy is a signal. Set `proxy_rate_per_1k_tokens=0` to collapse.

**Out of scope:** CSV import from Lovable billing export, historical backfill, per-tool drift.
