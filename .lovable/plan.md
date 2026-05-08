Two refactors in one plan, executed back-to-back. Both align to `docs/design-system.md` and use the new pluggable panes (so settings/config that move out of the page bodies still have a home).

---

## Plan A — Roadmap cleanup (`/roadmap`)

### Problem

`Roadmap.tsx` is 796 lines that render everything in one scroll:
1. Page header + Next-up card + `AutoLogSettings` + `WorkLogPulse` + `TurnTracker` (header row)
2. `DailyPlanCard`
3. `AutomationPanel`
4. **Phases / sprints / tasks tree** (the actual roadmap)
5. Task detail panel with `TaskApprovalPanel`, `ReviewChecklistEditor`, `EvidencePanel`

Result: the roadmap itself sits below 5+ ops panels and is off-screen on first paint.

### Target shape

Roadmap-first, ops panels collapsed or moved. No data model changes.

```text
┌ Page header (title + subtitle + actions: Next up, Master plan link) ┐
├──────────────────────────────────────────────────────────────────────┤
│ Tabs: [ Roadmap ] [ Daily plan ] [ Automation ] [ Activity ]         │
│                                                                      │
│ ┌─ Roadmap (default tab) ─────────────────────────────────────────┐  │
│ │ Tree (left, 5/12)  │  Task detail (right, 7/12)                │  │
│ │                    │  • Task fields                            │  │
│ │                    │  • Approval / Checklist / Evidence (acc.) │  │
│ └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Concrete moves:

- **Tabs** at the page level: `Roadmap | Daily plan | Automation | Activity` (low-traffic things land here, not the roadmap tab).
- **Activity tab** holds `TurnTracker` + `WorkLogPulse` (the two "what's happening right now" widgets).
- **`AutoLogSettings`** leaves the page entirely — it's config, not run-time. Moves to `/admin` (Plan B in the next sprint, but for now keep the trigger, just collapse it behind a `<Sheet>` opened from the Automation tab so it's one click away if Admin tabs aren't shipped yet).
- **Task detail** inside the Roadmap tab — Approval, Checklist, and Evidence become an `<Accordion>` under the task fields (default: Approval open). Today they all render expanded simultaneously.
- **Page container** uses the design system canonical: `mx-auto w-full max-w-7xl px-4 py-4 space-y-6`. Title goes from `text-2xl` to `text-xl`.
- **Next up** card stays in the header actions row but shrinks to icon + title (full text on hover).

### Files

**Edited:**
- `src/pages/Roadmap.tsx` — extract three tab-body components inline (no new files needed): `<RoadmapTreeAndDetail/>`, plus tabs wrapping the existing components.
- `docs/design-system.md` — add a one-paragraph "applied to Roadmap" note in §11.
- `CHANGELOG.md` — Unreleased entry.

**No** new tables, no schema changes, no edge function changes.

### Out of scope

- Splitting `AutoLogSettings` and `ReviewChecklistEditor` out to `/admin` for real (separate plan when Admin gets tabs).
- Dragging the tree to virtualisation (works fine until ~1000 tasks).

---

## Plan B — Control Plane data hygiene (`/control-plane`)

### Problem

The page polls `events/recent` every 5s and pushes results into an in-memory array capped at 200, with no time filter and no pagination. Demand table is unbounded. Telegram bot config (`telegram-bot-info`, chat-id picker, send-test) lives on the same page as the realtime ops view, mixing config with runtime state. Will get painful long before "very fast" data growth becomes a real outage.

### Target shape

Three concrete fixes, no new tables.

#### B1. Event stream — server-side window + filters

- Replace the unbounded array with **two query knobs**:
  - **Time window**: `15m | 1h | 24h | 7d` segmented control (default `1h`).
  - **Source filter**: existing `all | okr | capability` (kept).
- Polling sends `since` *and* a window floor (`since_floor = now() - window`) to `events/recent`. Already-supported `since` cursor stays for incremental fetches; window floor enforced client-side until the edge function gains it (out of scope for this plan).
- In-memory cap moves from 200 to **window-aware**: discard rows older than `now() - window`. With a 1h window the array stays small even on a chatty day.
- Add a small "Showing N events from last X" line above the list with a "Load older" button that bumps the window one notch (1h → 24h → 7d).

#### B2. Demand table — virtualise + paginate

- Wrap the demand table body in `@tanstack/react-virtual` (already a transitive dep via shadcn? — check; if not, add it).
- Default page size 50 with "Show 50 / 200 / all" segmented control.
- Filters (status / tenant / min-active) push down to `?status=…` query params on `capabilities/demand` so we don't fetch rows we'll discard. (The endpoint may already accept these — check before changing it; if it doesn't, filter client-side as today and flag the endpoint enhancement as a follow-up.)

#### B3. Split bot config out

- Move the **Telegram bot panel** (bot info card, chat-id picker, send-test, mismatch banner) to a new component `src/components/admin/TelegramBotPanel.tsx`.
- Render it on `/admin` (gated by admin role, alongside `AppSecretsPanel`). This is the right home for it — it's config + secrets-shaped UI, not a runtime stream.
- `/control-plane` keeps a **one-line status chip** ("Telegram: @awip_ops_bot ✓" / "Telegram: not configured") that links to `/admin#telegram`. Removes ~150 lines from ControlPlane.tsx.
- `ApprovalDecisions` stays on Control Plane — it *is* runtime ops.

### Files

**New:**
- `src/components/admin/TelegramBotPanel.tsx` — the moved bot UI, unchanged behaviour.
- `src/components/control-plane/EventStream.tsx` — extracted event list + window/source controls.
- `src/components/control-plane/DemandTable.tsx` — extracted virtualised demand table.

**Edited:**
- `src/pages/ControlPlane.tsx` — slimmed to: page header, two child components, the Telegram status chip, and `ApprovalDecisions`. Target ~250 lines.
- `src/pages/Admin.tsx` — render `TelegramBotPanel` (will get proper tabs in the future Admin plan; for now stack it).
- `docs/architecture.md` — one-line note that bot config lives on `/admin`.
- `CHANGELOG.md` — Unreleased entry.

**No** schema changes. **No** edge function signature changes (we keep `events/recent` and `capabilities/demand` as-is and use existing query params; if the demand endpoint doesn't accept push-down filters we leave them client-side and call out the follow-up).

### Out of scope

- Server-side time-window enforcement on `events/recent` (follow-up edge-function change).
- Migrating events to a paginated table view at `/events` (already exists).
- Admin tabs (next plan).

---

## Validation

- `/roadmap` paints with the tree visible above the fold on a 1366×768 screen.
- Switching tabs inside `/roadmap` does not refetch the tree.
- Task detail accordions remember which sections were expanded per session (sessionStorage, key per task).
- `/control-plane` event stream shows ≤ window-size rows; switching window filter is instant.
- Demand table scrolls smoothly with 1000+ rows.
- Telegram bot panel renders correctly on `/admin` and is gated to admin role.
- No regressions in `ApprovalDecisions` or the existing realtime channels.
