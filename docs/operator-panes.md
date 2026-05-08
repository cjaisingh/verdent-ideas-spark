# Operator panes

The operator console uses a 4-mode pane layout controlled by the toggle row in the header.

## Modes

| Icon (lucide) | Mode      | Layout                                          | Shortcut |
|---------------|-----------|-------------------------------------------------|----------|
| `PanelLeft`   | `left`    | left sidebar only                               | ⌘1 / Ctrl+1 |
| `Columns2`    | `dual`    | left sidebar + right Night Agent feed           | ⌘2 / Ctrl+2 |
| `Square`      | `centre`  | all panes closed — main content fills viewport  | ⌘3 / Ctrl+3 |
| `PanelBottom` | `bottom`  | left sidebar + bottom live event ticker         | ⌘4 / Ctrl+4 |

Shortcuts are ignored while typing in inputs/textareas.

On mobile (<768px) the layout is forced to `centre`; the existing offcanvas sidebar drawer is unaffected.

## Persistence

State is stored in `localStorage` under `awip.panes.v1`, keyed by the **first path segment** of the route (e.g. `/capabilities`, `/roadmap`, `/night`). Each top-level route remembers its own mode independently, so opening the right pane on `/capabilities` does not affect `/roadmap`.

```ts
type PaneMode = "left" | "dual" | "centre" | "bottom";
type PaneState = { mode: PaneMode; rightWidth: number; bottomHeight: number };
```

`rightWidth` and `bottomHeight` are stored as **panel-group percentages** (0–100) and updated live via `react-resizable-panels`' `onResize` callback. When you switch back to a route, the saved size is reapplied as `defaultSize` (the panel group is keyed by mode so it remounts cleanly).

## Pane content

- **Right (`RightPaneNightAgent`)** — last 30 `night_observations`, prepended in real time. Header dot shows whether the current UTC time is inside the 22:00–06:00 night window.
- **Bottom (`BottomPaneEventTicker`)** — merged stream of `okr_node_events`, `capability_events`, and `discussion_action_events` (capped at 200, newest first). Tabs filter by source; pause/resume freezes the auto-prepend.

## Adding a new pane

1. Create the component under `src/components/panes/`.
2. Add a new `PaneMode` value and matching entry in `MODES` inside `src/components/PaneToggleGroup.tsx`.
3. Update `paneFlags()` in `src/lib/pane-state.ts` to map the new mode to `{ left, right, bottom, … }` flags.
4. Render it conditionally in `OperatorLayout.tsx`.
