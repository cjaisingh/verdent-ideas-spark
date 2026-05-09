## Goal

Make `/night-shifts` answer the question *"if a shift opens right now, what would it actually do?"* — independent of whether a shift is currently running. A unified, linked backlog table at the top of the page, fed from every source that can hand work to the night agent.

## What gets added

A new **`NightBacklogTable`** section rendered above the existing shifts list on `src/pages/NightShifts.tsx`. It shows one row per pending work item, regardless of source.

### Columns

| Source | Subject | Title / summary | Eligible window | Queued | Link |
|---|---|---|---|---|---|
| badge | e.g. `#42` discussion_action | first 80 chars | "tonight 22:00–06:00 UTC" or "next window" | relative time | opens detail |

### Sources unified into one backlog

1. **Discussion audits** — `discussion_actions` where `night_eligible = true AND status = 'open'`. Source badge: `audit`. Link → `/discussions/{discussion_id}#action-{short_num}` (existing route used by `DiscussionActionsPanel`).
2. **Overnight phase runs** — `roadmap_phase_overnight_runs` where `status IN ('queued','running')`. Source badge: `phase`. Link → `/roadmap?phase={phase_key}`.
3. **Pending proposals from prior shifts** — `night_proposals` where `status = 'pending'` (operator hasn't accepted/rejected yet — they'll roll into the next shift's review). Source badge: `proposal`. Link scrolls to that shift in the list below.

Each row also shows whether the item is *gated out* by current `memory_settings`:
- `night_agent_enabled = false` → all rows show "agent disabled" badge
- item kind not in `night_allowed_kinds` → row shows "kind blocked" badge
- today is in `night_blackout_dates` → "blackout" badge

### Header summary strip

Above the table:
- `N items queued · X audits · Y phases · Z proposals`
- Current window state from `memory_settings` (`22:00–06:00 UTC`, in/out of window now)
- Link "Run now" that calls the existing `night-agent/open` manual trigger (reuses the fetch pattern from `ManualOvernightTriggers`) — only enabled when in window or operator confirms

### Empty state

If everything is empty: a clear "Backlog is empty — opening a shift now would do nothing" panel with three short CTAs:
- "Mark a discussion action night-eligible" → `/discussions`
- "Queue a roadmap phase" → `/roadmap`
- "Review past proposals" → scroll to first shift below

This is exactly the situation we hit tonight (shift opened, 0 candidates) — the panel will make that obvious without needing to read `automation_runs`.

## Realtime

Extend the existing `night_shifts_page` channel with subscriptions to `discussion_actions`, `roadmap_phase_overnight_runs`, and `memory_settings` so the backlog updates live as items become eligible.

## Files touched

- **Create** `src/components/night/NightBacklogTable.tsx` — the unified table + header strip + empty state.
- **Edit** `src/pages/NightShifts.tsx` — load the three sources in the existing `load()`, render `<NightBacklogTable />` above the shifts list, extend realtime channel.

No DB migrations, no edge function changes — everything we need is already in the schema and RLS.

## Out of scope (call out, don't build)

- Changing eligibility rules themselves (still `night_eligible=true AND status=open`).
- Editing items inline from the backlog (links go to their existing edit surfaces).
- Adding new "sources" of night work beyond the three above — if more emerge later, the table is structured so adding a 4th source is one query + one row mapper.
