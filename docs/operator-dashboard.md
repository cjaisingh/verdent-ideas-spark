# Operator dashboard

`/dashboard` is the per-operator landing page. Up to **4 named tabs**, each using one of four fixed bento templates and rendering small **widgets** from a registry.

## Tabs

- 1–4 tabs, persisted server-side in `operator_dashboards` (one row per user, `tabs jsonb`, `active_tab_id`).
- Tab switches are saved immediately. Other edits debounce a single save at 800ms idle.
- Drag tab labels in **Edit** mode to reorder. Double-click a label to rename. Cannot delete the last tab.

## Templates

| Id                  | Layout                       | Slots                    |
|---------------------|------------------------------|--------------------------|
| `grid-2x2`          | 2 × 2                        | 4 × md                   |
| `one-plus-three`    | hero left + 3 small right    | 1 × lg + 3 × sm          |
| `hero-strip`        | wide hero on top + 4 small   | 1 × lg + 4 × sm          |
| `dense-six`         | 3 × 2                        | 6 × sm                   |

Switching to a smaller template prompts a confirm — extra widgets are dropped.

## Widget contract

Each widget lives in `src/components/dashboard/widgets/<Kind>Widget.tsx` and implements:

```ts
interface DashboardWidgetProps {
  size: "sm" | "md" | "lg";   // fixed by the slot
  onOpen?: () => void;        // header arrow → source page
}
```

Rules:
- Self-contained data fetch via existing hooks/queries — never add a new table just to feed a widget.
- `WidgetShell` provides the bordered card, title row, and `→` open icon.
- Empty state = single muted line. Errors = `unavailable` line; never block the dashboard.
- Register the widget in `src/components/dashboard/widgets/registry.ts` (label, description, default size, component) so the Add-Widget picker discovers it.

## Seeded widgets (v1)

| Kind                       | Source                                                   |
|----------------------------|----------------------------------------------------------|
| `pending-approvals`        | `approval_queue` where `status = 'pending'`              |
| `night-observations-24h`   | `night_observations` last 24 h                           |
| `open-risks`               | `roadmap_review_findings` where `acknowledged = false`   |
| `recent-capability-events` | latest 10 `capability_events`                            |

## First-visit seed

If the operator has no `operator_dashboards` row, one is created with a single **Today** tab using template `one-plus-three`, pre-filled with `pending-approvals` (lg) + `open-risks`, `night-observations-24h`, `recent-capability-events`.
