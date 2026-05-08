## Cursor-style pane toggles for the operator console

Add a 4-icon pane control row to the header in `OperatorLayout`, exactly matching the screenshot. Wire a right pane to a Night Agent feed and a bottom pane to a live event ticker. State persists per route.

### The 4 icons (matching screenshot, left → right)

| Icon (lucide)      | Mode             | Behavior                                                                    |
|--------------------|------------------|-----------------------------------------------------------------------------|
| `PanelLeft`        | Left only        | Left sidebar open, right + bottom closed                                    |
| `Columns2`         | Dual             | Left + right both open, bottom closed                                       |
| `Square`           | Centre / focus   | All panes closed — only main content visible (the "centre pane" state)      |
| `PanelBottom`      | Bottom           | Bottom drawer open; left/right keep their last user state                   |

Behavior:
- Buttons act as a radio-style mode picker: clicking one snaps the layout to that preset.
- The currently active mode gets `bg-muted text-foreground`; others are `text-muted-foreground`. Tooltips on each.
- A user can still drag pane edges to resize after picking a mode (sizes remembered per route).
- Keyboard shortcuts: `⌘1` left, `⌘2` dual, `⌘3` centre, `⌘4` bottom. Disabled while typing in inputs.

### Layout

```text
┌──────────────────────────────────────────────────────┐
│ header  [▮ ▮▮ ▭ ▁]   AWIP Core   pending  signout    │
├──────┬─────────────────────────────────┬─────────────┤
│ left │         main / <Outlet/>        │   right     │
│ nav  │                                 │   night     │
│      ├─────────────────────────────────┤   agent     │
│      │   bottom: live event ticker     │   feed      │
└──────┴─────────────────────────────────┴─────────────┘
```

- Keep `SidebarProvider` + existing `AppSidebar` for the left pane.
- Wrap (main + bottom) in a vertical `ResizablePanelGroup`, then wrap (that + right) in a horizontal `ResizablePanelGroup` from `react-resizable-panels` (already available via shadcn `resizable`).

### Right pane: Night Agent feed

`src/components/panes/RightPaneNightAgent.tsx`
- Default 340px (min 240, max 480).
- Header: "Night Agent" + status dot (in/out of 22:00–06:00 UTC window).
- List: latest 30 `night_observations` joined to `discussion_actions` for title/short_num, ordered `created_at desc`. Severity chip · verdict · time-ago · click → `/night`.
- Realtime: subscribed to `night_observations` so new rows prepend live.
- Empty state: "No observations yet tonight."

### Bottom pane: Live event ticker

`src/components/panes/BottomPaneEventTicker.tsx`
- Default 220px (min 120, max 480).
- Tabs: `All` · `OKR` · `Capability` · `Discussion`.
- Streams `okr_node_events`, `capability_events`, `discussion_action_events` via realtime; merged client-side, newest first, capped at 200.
- Each row: timestamp · source badge · event type · short payload summary · "open" link (`/roadmap`, `/capabilities/:id`, `/night`).
- Pause/resume button to freeze auto-scroll.

### Per-route persistence

`src/lib/pane-state.ts`:
```ts
type PaneMode = "left" | "dual" | "centre" | "bottom";
type PaneState = { mode: PaneMode; rightWidth: number; bottomHeight: number };
function usePaneState(routeKey: string): [PaneState, (p: Partial<PaneState>) => void];
```
- Stored in `localStorage` under `awip.panes.v1`, keyed by the first path segment (e.g. `/capabilities`).
- Defaults: `mode: "left"`, rightWidth 340, bottomHeight 220.
- Reads on mount and on route change so each page restores its own layout.

### Files

**New**
- `src/components/PaneToggleGroup.tsx`
- `src/components/panes/RightPaneNightAgent.tsx`
- `src/components/panes/BottomPaneEventTicker.tsx`
- `src/lib/pane-state.ts`
- `docs/operator-panes.md` (modes, shortcuts, persistence, how to add another pane)

**Edited**
- `src/components/OperatorLayout.tsx` — render the resizable shell + `PaneToggleGroup` in the header; remove the lone `SidebarTrigger`.
- `README.md` — one line under "Operator console" describing the pane modes/shortcuts.
- `CHANGELOG.md` — entry under Unreleased.

### Out of scope

- No backend changes. No new tables, no edge function edits.
- Mobile (<768px): always forced to centre mode; only the existing mobile sidebar drawer remains.
- No drag-to-reorder; pane positions fixed.

### Validation

- Click each of the 4 icons → layout snaps to the matching preset; centre hides everything.
- Reload `/capabilities` in dual mode and `/roadmap` in centre → both restored independently.
- Insert rows into `night_observations` and `okr_node_events` → both panes update without refresh.
- Keyboard shortcuts work and don't fire while typing in inputs.
