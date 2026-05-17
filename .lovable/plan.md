## Current balance + per-phase balance snapshots → real run-rate

Two linked pieces:
1. A **running balance** so the dashboard shows days-of-runway, not just spend.
2. An **end-of-phase prompt** that captures the operator's then-current balance against the phase that just closed, giving a per-phase delta over time.

### Schema (1 migration)

**`credit_balance_snapshots`** (new table)
- `id uuid pk`
- `balance_credits numeric not null`
- `as_of timestamptz not null default now()`
- `phase_id uuid null references roadmap_phases(id) on delete set null`
- `source text` — free text (e.g. "Lovable dashboard", "phase-close prompt")
- `note text`
- `created_by uuid`
- Index on `(as_of desc)` and `(phase_id, as_of desc)`
- Operator-only RLS + realtime

**`v_credit_balance_latest`** — single row: most recent snapshot.

**`v_credit_runway`** — single row:
- `balance`, `as_of` from latest snapshot
- `spent_since_as_of` from `v_credit_burn_per_step` where `occurred_at >= as_of`
- `estimated_balance_now = balance − spent_since_as_of`
- `burn_per_day_7d` / `burn_per_day_21d` (reuse existing burn averages)
- `days_runway_21d`, `runway_exhaustion_date_21d`

**`v_credit_phase_deltas`** — per phase, ordered by close: opening balance (latest snapshot before phase start), closing balance (snapshot tagged with that `phase_id`), `delta_credits`, `logged_spend` (sum from `v_credit_burn_per_step` for that phase), `unaccounted = delta − logged_spend`. Lets you see drift between what you logged and what actually burned.

### End-of-phase prompt

Trigger surface: existing roadmap phase close action (wherever `roadmap_phases.status` transitions to `done` / `closed`). Two options — pick one:

**A. Modal on phase close** (preferred): when operator marks a phase done in `/roadmap` or `/master-plan`, a "Record balance" dialog opens with `balance_credits` (required), `source`, `note`. Submitting writes a `credit_balance_snapshots` row with `phase_id` set. Skipping is allowed but tracked.

**B. Discussion action** (lighter): on phase close, insert a `discussion_action` "Record credit balance for phase X" with a deeplink that opens the same dialog standalone. Survives if the operator wasn't on the roadmap page when closing.

I'd build **A** as primary and **B** as a 24h follow-up if the snapshot is still missing (sentinel-tick check: phases closed in last 24h with no snapshot → discussion_action).

### UI

**`ProjectedSpendPanel`** — new 5th card "Estimated balance" + "≈ N days runway (21d burn)". Amber <14d, red <7d. Tooltip shows `as_of` + `source`. Stale banner when `as_of > 7 days ago`.

**Settings sheet** — new "Current balance" section with number input + optional source/note. Saves a snapshot (no `phase_id`).

**New `BalanceHistoryPanel`** on the Credits & Usage tab — table of snapshots (when, balance, phase if any, source, note) + small line chart. Below the new card.

**`v_credit_phase_deltas` table** — small panel on the same tab showing last 10 closed phases with logged vs delta, highlighting `unaccounted` outliers.

### Alerts

New sentinel-tick check `credit_runway_low`: warn at `days_runway_21d < 14`, critical at `< 7`. Reuses `credit_alerts` pattern, once per (year_month, band). Existing 80/100% projected-EOM alert stays.

Second check `phase_close_balance_missing`: phases closed >24h ago with no snapshot → discussion_action (one per phase, idempotent).

### Docs / memory

- `docs/credits-usage.md` — "Balance, runway, per-phase deltas" section.
- `mem/features/credits-usage.md` — append snapshots table + views + phase-close hook.
- `CHANGELOG.md`.

### Out of scope
- Auto-pull from Lovable (no API).
- Multi-account balances.
- Backfilling historical phase deltas (starts now).

### Files
- Migration: table + 3 views + indexes + RLS.
- Edit: `ProjectedSpendPanel.tsx`, `CreditsUsagePanel.tsx` (SettingsForm + mount new panels), roadmap phase-close component (locate in plan execution), `sentinel-tick/checks.ts`, docs, memory.
- Create: `BalanceSnapshotDialog.tsx`, `BalanceHistoryPanel.tsx`, `PhaseDeltasPanel.tsx`.