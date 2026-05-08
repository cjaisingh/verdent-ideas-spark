# Operator panes

The operator console uses a 4-mode pane layout controlled by the toggle row in the header. The right and bottom panes are **pluggable**: each has a smart default per route and an in-pane picker to swap source.

## Modes

| Icon (lucide) | Mode      | Layout                                          | Shortcut |
|---------------|-----------|-------------------------------------------------|----------|
| `PanelLeft`   | `left`    | left sidebar only                               | ⌘1 / Ctrl+1 |
| `Columns2`    | `dual`    | left sidebar + right pane                       | ⌘2 / Ctrl+2 |
| `Square`      | `centre`  | all panes closed — main content fills viewport  | ⌘3 / Ctrl+3 |
| `PanelBottom` | `bottom`  | left sidebar + bottom pane                      | ⌘4 / Ctrl+4 |

Shortcuts are ignored while typing in inputs/textareas. On mobile (<768px) the layout is forced to `centre`.

## Persistence

Stored in `localStorage` under `awip.panes.v1`, keyed by the **first path segment** of the route (`/capabilities`, `/roadmap`, …). Each top-level route remembers its mode, sizes, **and source choices** independently.

```ts
type PaneMode = "left" | "dual" | "centre" | "bottom";
type PaneSlotKey = "right" | "bottom";
type PaneState = {
  mode: PaneMode;
  // …sizes (per viewport+mode)
  sourcesByViewportSlot?: Partial<Record<ViewportClass, Partial<Record<PaneSlotKey, string>>>>;
};
```

`rightWidth` / `bottomHeight` are panel-group percentages; saved per viewport class so a wide-screen size doesn't crush a narrow one.

## Pane sources

Both slots can host any source. The picker lives in the pane header (icon + label dropdown). The selection is stored per route + viewport.

| Source id | Label | Tint | Default route |
|---|---|---|---|
| `night-agent` | Night Agent | `tint-night` | `/night` |
| `event-ticker` | Event ticker | `tint-event` | `/events` |
| `approvals` | Pending approvals | `tint-approval` | `/admin` |
| `discussion-actions` | Discussion actions | `tint-discussion` | `/jobs` |

### Per-route defaults

`src/lib/pane-defaults.ts`:

| Route | Right default | Bottom default |
|---|---|---|
| `/dashboard` | Night Agent | Event ticker |
| `/roadmap` | Approvals | Event ticker |
| `/capabilities` | Night Agent | Event ticker |
| `/jobs` | Discussion actions | Event ticker |
| `/copilot` | Discussion actions | Event ticker |
| `/night` (-shifts) | Night Agent | Event ticker |
| `/admin`, `/approvals` | Approvals | Event ticker |
| (fallback) | Night Agent | Event ticker |

Defaults apply when no override is saved for that (route, viewport, slot). The picker shows a small amber dot when the slot is overridden; "Reset to route default" is the last item in the dropdown.

The big "Reset layout" button in the header (`RefreshCw`) clears mode, sizes, **and** source overrides for the current route.

## Adding a new source

1. Create a body-only component under `src/components/panes/bodies/`. It owns its own scrolling (`h-full overflow-y-auto`) and sub-toolbars, but **not** the source picker header — `PaneSlot` provides that.
2. Register it in `src/components/panes/sources.ts`: id, label, lucide icon, tint classes from `docs/design-system.md`, canonical `openHref`, and a `lazy()` import of the body.
3. (Optional) Add it to the per-route default map in `src/lib/pane-defaults.ts` if a particular route should land on it by default.
