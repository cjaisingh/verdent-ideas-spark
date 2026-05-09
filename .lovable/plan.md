## Why the night agent had nothing to do

Two distinct things both look like "night work" and got conflated:

1. **Discussion-action audits** — both `night_eligible=true` items (JOB-1, JOB-2) had already been **promoted** to roadmap tasks, so their `status` flipped to `in_progress`. The night agent only audits `status='open'`. That's why the backlog was 0 even though `night` chips are still visible on `/jobs`.
2. **Roadmap "Run overnight"** — `roadmap_phase_overnight_runs` is empty. Marking a discussion-action night-eligible never queues the resulting roadmap phase. Each phase has its own opt-in "Run overnight" button that nobody clicked.

The night agent's job is to *audit and propose* — it does not execute promoted roadmap tasks. That's by design (substrate, not a brain). The fix is to (a) make that obvious in the UI, and (b) give you a way to say "always run this phase overnight" without clicking it every evening.

## Plan

### Part 1 — UI clarity (no behaviour change)

- **`/jobs`**: when an item is promoted (`status` ≠ `open`), keep the `night` chip but render it muted with tooltip *"audit complete · promoted on {date} — night agent will not re-audit"*. Stops it looking like work-in-progress for the night agent.
- **`/night-shifts` backlog empty state**: add an explicit line *"You have N night-eligible actions but they're already promoted — the night agent only audits open actions."* with a link to `/jobs?night=1` filtered to promoted items.
- **`/overnight` overview**: split the "queued" tile into `audits queued | phases queued | auto-queued tonight` so the difference between the two pipelines is visible at a glance.

### Part 2 — Per-phase "queue every night" flag

Adds a persistent opt-in so a roadmap phase gets queued automatically each evening until it ships.

**DB migration**
- Add `roadmap_phases.run_overnight boolean NOT NULL DEFAULT false`.
- Add `roadmap_phases.run_overnight_until date NULL` (optional auto-stop; defaults to NULL = forever).

**UI**
- In `OvernightRunControl.tsx` (next to "Run overnight" button), add a small toggle: **"Queue every night"**. When on, shows a hint *"will be queued automatically at 21:55 UTC if not shipped"*. When the phase status reaches `shipped`/`done`, the flag is auto-cleared by a trigger.

**New edge function `overnight-prequeue`**
- Cron at `55 21 * * *` UTC.
- Auths via `AWIP_SERVICE_TOKEN` (same pattern as other overnight crons).
- For each `roadmap_phases` where `run_overnight=true AND status NOT IN ('shipped','done','cancelled') AND (run_overnight_until IS NULL OR run_overnight_until >= today)`, insert one `roadmap_phase_overnight_runs` row with `status='queued'`, `requested_by=NULL` (system), `scheduled_for=today+1`, **only if no queued/running run already exists for that phase today**.
- Logs to `automation_runs` with `job='overnight-prequeue'` (success/partial/error) and dispatches `auth_failed` alerts via the existing shared `dispatchAlert` helper.

**Operator visibility**
- Add `overnight-prequeue` to the `/overnight` "recent errors" filter list and to `ManualOvernightTriggers` on `/admin` so you can fire it on demand.
- The `/night-shifts` backlog already lists `roadmap_phase_overnight_runs` with `status IN ('queued','running')` — auto-queued rows show up there with a small "auto" badge if `requested_by IS NULL`.

### Part 3 — Backfill tonight

Once Part 2 ships and you flip the toggle on the phases you actually want done overnight, the next 21:55 UTC tick queues them. To not wait until tomorrow, the new flag's UI also has a one-click **"Queue now too"** that inserts a single row immediately (same insert as the existing manual button).

## Out of scope

- Auto-executing audited & promoted roadmap tasks the same night. Substrate philosophy says no — the operator decides when execution happens. (`roadmap_phase_overnight_runs` is the explicit opt-in surface for that.)
- Loosening the audit filter to include `in_progress` — would create duplicate audits and noisy observations.

## Files

- **Migration**: add `run_overnight`, `run_overnight_until` to `roadmap_phases` + trigger to clear the flag on ship/done/cancelled.
- **New** `supabase/functions/overnight-prequeue/index.ts`.
- **New** cron schedule for `overnight-prequeue` at `55 21 * * *`.
- **Edit** `src/components/roadmap/OvernightRunControl.tsx` — add toggle + "Queue now too".
- **Edit** `src/pages/Jobs.tsx` — muted `night` chip on promoted items.
- **Edit** `src/components/night/NightBacklogTable.tsx` — empty-state copy + auto-queued badge.
- **Edit** `src/pages/OvernightOverview.tsx` — split queued tile into audits/phases/auto.
- **Edit** `src/components/admin/ManualOvernightTriggers.tsx` — add prequeue trigger.
