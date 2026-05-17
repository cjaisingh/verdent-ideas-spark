## Goal

Make every manual credit-balance reading countable. Each time you record a balance, the app:

1. Captures **what triggered it** (free-form label + optional task/discussion link, in addition to today's optional phase tag).
2. Computes **delta since previous snapshot** (auto, no input).
3. Compares delta to **logged spend** in the same window → drift %.
4. Raises a **sentinel finding** if no snapshot has been recorded for too long, so it never goes unchecked.

No new tables — extend `credit_balance_snapshots`. Reuses the existing `BalanceSnapshotDialog` and `BalanceHistoryPanel` on `/admin/ai-usage`.

## Schema changes (migration)

`credit_balance_snapshots` gains:

- `label text` — free-form, e.g. `"model picker"`, `"worker checklist"`.
- `subject_type text` — nullable, one of `roadmap_phase` (existing) | `discussion_action` | `roadmap_task` | `dev_turn` | `manual`. Derived in trigger so `phase_id` keeps working.
- `subject_id uuid` — generic FK-by-id (no DB FK; validated in trigger against the matching table when set).

Index: `(occurred_at desc)` for the deltas view (already covered by existing index — check, add if missing).

## Views (SECURITY INVOKER)

- `v_credit_snapshot_deltas` — for each snapshot, prev snapshot's `balance_credits`, `delta = prev - curr`, window start/end, `logged_credits_in_window` (sum of `credit_entries.credits` for `occurred_at` in window), `drift_credits = delta - logged`, `drift_ratio = delta / nullif(logged,0)`, `drift_band`:
  - `match` — `|drift_ratio - 1| ≤ 0.1`
  - `over-logged` — actual delta < logged (logged too much)
  - `under-logged` — actual delta > logged by >10% (logged too little)
  - `no-logged` — `logged = 0`
- `v_credit_snapshot_latest_age` — single row: minutes since most recent snapshot, count of snapshots in last 24h, count of `credit_entries` since latest snapshot.

## UI on `/admin/ai-usage` Credits & Usage tab

- **`BalanceSnapshotDialog`** — add:
  - `Label` input (autofocus when no phase set).
  - "Link to…" combobox: type-ahead over open `discussion_actions` + recent `roadmap_tasks`; selecting sets `subject_type` + `subject_id`. Phase prompt path keeps `subject_type='roadmap_phase'`.
- **New `BalanceTrackingPanel`** above existing `BalanceHistoryPanel`:
  - Header row: latest balance · `Xh Ym since last snapshot` · `N developments un-snapshotted` (count of `credit_entries` since last snapshot).
  - One-click "Record now" button → opens dialog with no preset.
  - Compact table of last 20 snapshots from `v_credit_snapshot_deltas`: `when`, `label / subject`, `balance`, `Δ` (red if negative=spent), `logged in window`, `drift` chip (`match` green, `over-logged` amber, `under-logged` red, `no-logged` grey). Click row → drawer with the matching `credit_entries` rows in that window so you can attribute or add missing entries.
- `BalanceHistoryPanel` gets a `Drift` column wired to the same view.

## Cadence enforcement — sentinel finding

New check in `supabase/functions/sentinel-tick/checks.ts`:

- **`credit_snapshot_stale`** — reads `v_credit_snapshot_latest_age`.
  - `warn` (high): `minutes_since_latest > 240` (4h) **and** ≥3 entries logged since.
  - `critical`: `minutes_since_latest > 1440` (24h) **and** ≥1 entry since.
  - Dedup key: `credit_snapshot_stale` once per UTC day (matches existing `credit_runway` pattern).
  - Surfaces on Morning Review via existing sentinel rollup.

## Contract

Add `supabase/functions/_shared/contracts/credit-snapshot.ts` describing the snapshot input shape (per project contract-first rule). No new edge function needed — inserts stay client-side under operator-only RLS.

## Docs + memory

- `docs/credits-usage.md` — new "Per-snapshot tracking & drift" section + sentinel entry.
- `CHANGELOG.md` — Added entry.
- `mem/features/credits-usage.md` — append: label/subject_type/subject_id, `v_credit_snapshot_deltas`, `credit_snapshot_stale` sentinel.

## Out of scope

- Auto-creating a snapshot from chat activity (no signal from Lovable build loop into Cloud).
- Editing past snapshots — record-only, like today.
- Reconciling against any Lovable billing API (none exists; project memory).

## File list

```text
supabase/migrations/<ts>_credit_snapshot_tracking.sql   (new)
supabase/functions/_shared/contracts/credit-snapshot.ts (new)
supabase/functions/sentinel-tick/checks.ts              (edit: add credit_snapshot_stale)
src/components/admin/BalanceSnapshotDialog.tsx          (edit: label + subject combobox)
src/components/admin/BalanceTrackingPanel.tsx           (new)
src/components/admin/BalanceHistoryPanel.tsx            (edit: drift column)
src/pages/AdminAiUsage.tsx                              (edit: mount BalanceTrackingPanel)
docs/credits-usage.md, CHANGELOG.md, mem/features/credits-usage.md (edit)
```
