# Credits: close the loop

Three additions on top of the balance/runway work already shipped.

## 1. Runway-low alert (sentinel-tick)

New check `credit_runway_low` in `supabase/functions/sentinel-tick/checks.ts`.

- Reads `v_credit_runway` once per tick.
- Bands:
  - `warn` when `days_runway_21d < 14`
  - `critical` when `days_runway_21d < 7`
- Skip if `as_of` older than 7 days (stale snapshot → not actionable, falls under the "missing balance" path instead).
- Skip if `burn_per_day_21d <= 0` (no recent spend → infinite runway, no alert).
- Fires Telegram via `telegram-send` with format:
  `[CREDITS] Runway {days}d at burn {x}/day. Balance {b} as of {as_of}. → /admin/ai-usage`
- Idempotency: reuse the existing `credit_alerts` table from the budget-alerts work. New `kind` values `runway_warn` / `runway_critical`, keyed by `(year_month, kind)` so each band fires at most once per calendar month. Re-arms when month rolls over OR when a new snapshot pushes runway back above the threshold for ≥48h (clear → re-fire allowed).
- Writes a `sentinel_findings` row at matching severity so it lands on Morning Review.

## 2. Auto-prompt at phase close

Replace passive `PhasesAwaitingBalancePanel` reliance with an active nudge.

- Trigger `tg_roadmap_phase_close_balance_prompt` on `roadmap_phases AFTER UPDATE`:
  - Fires only on `status` transition to `done`.
  - Inserts a `discussion_action` `{ kind: 'credit_balance_snapshot', title: 'Record closing balance for phase: <name>', risk: 'low', night_eligible: true, deeplink: '/admin/ai-usage?phase=<id>&prompt=balance' }`.
  - Idempotent: skip if a `discussion_action` with the same `kind` and `phase_id` already exists in `open` state.
- `/admin/ai-usage` reads `?phase=<id>&prompt=balance` and auto-opens `BalanceSnapshotDialog` pre-filled with that phase.
- Recording a snapshot for that phase auto-resolves the matching `discussion_action`.
- Keep `PhasesAwaitingBalancePanel` as a fallback view for anything that slips through (e.g. trigger disabled, old phases).
- 24h follow-up: existing sentinel `v_phases_awaiting_balance` continues to surface anything still missing after a day.

## 3. Drift-adjusted projections

Use observed `unaccounted` from `v_credit_phase_deltas` to scale projections.

- New view `v_credit_drift_ratio_by_category`:
  - Joins `roadmap_phases` → `v_credit_phase_deltas` → `work_category` (via `src/lib/workCategory.ts` mapping logic mirrored in SQL or a stored function).
  - Per category, last 8 closed phases with both opening+closing snapshots:
    - `logged_total`, `actual_total = sum(opening - closing)`, `drift_ratio = actual_total / NULLIF(logged_total, 0)`.
  - Returns `category`, `phase_sample_count`, `drift_ratio`, `confidence` (`high` ≥6 samples, `medium` 3–5, `low` <3).
- New view `v_credit_drift_ratio_overall`: single row, same maths across all categories combined, fallback when category-specific ratio is `low` confidence.
- `ProjectedSpendPanel`:
  - Multiply each projected line by the matching category drift ratio when confidence ≥ `medium`, else use overall ratio, else use `1.0` (no adjustment).
  - Show a small "Adjusted ×1.23 (from drift)" annotation under each projection so the operator sees the correction and can sanity-check it.
  - Add an "Unadjusted" toggle to flip back to raw projections.
- `SpendByCategoryPanel`: append a "Drift" column showing the per-category ratio + sample count, so the operator can spot categories where logging is systematically off.

## Out of scope

- Auto-pull from Lovable (still no API).
- Backfilling historical snapshots (option 3 from prior turn, parked).
- Per-tool drift (only per-category for now — drift signal is too noisy at tool granularity until we have more phases).

## Files

**Migration (1):**
- `supabase/migrations/<ts>_credit_runway_drift.sql` — trigger + 2 views + `credit_alerts.kind` accepts new values.

**Edge functions:**
- `supabase/functions/sentinel-tick/checks.ts` — add `credit_runway_low` check.

**Frontend:**
- `src/components/admin/ProjectedSpendPanel.tsx` — drift adjustment + toggle + annotation.
- `src/components/admin/SpendByCategoryPanel.tsx` — Drift column.
- `src/pages/AdminAiUsage.tsx` (or wherever the route lives) — read `?phase=&prompt=balance` and auto-open dialog.
- `src/components/admin/BalanceSnapshotDialog.tsx` — on success, resolve matching `discussion_action`.

**Docs/memory:**
- `docs/credits-usage.md` — three new sections.
- `CHANGELOG.md`.
- `mem/features/credits-usage.md` — update with runway alert, auto-prompt trigger, drift ratio.
- `mem/index.md` — Core line tweak if needed; keep memory entry pointer intact.

## Verification

- Insert a low-balance snapshot in a scratch test, tick sentinel, confirm Telegram fires once and `credit_alerts` row written; second tick same month silent.
- Flip a `roadmap_phase` to `done`, confirm `discussion_action` created and deeplink auto-opens dialog with phase pre-selected; re-flipping (idempotency) does not duplicate.
- Spot-check drift view against `v_credit_phase_deltas` totals for one category by hand.
