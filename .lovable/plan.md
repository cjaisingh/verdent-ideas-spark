## Operator Dashboard (`/dashboard`)

A per-operator landing page with 1–4 named tabs. Each tab uses one of four fixed bento templates and renders widgets from a small contract. Persisted server-side so it follows the operator across machines. Reuses existing hooks/queries — no new domain data.

### 1. Route + nav

- New page: `src/pages/Dashboard.tsx` at `/dashboard`, behind `RequireAuth` + `OperatorLayout`.
- Sidebar entry **Dashboard** (icon `LayoutDashboard`) at the very top of the **Operate** group, above Tenants. Pinnable like any other row.
- After first sign-in, `/dashboard` is the recommended default but we do **not** change `/` redirects in this iteration.

### 2. Data model (one new table)

```sql
create table public.operator_dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,           -- one row per operator
  tabs jsonb not null default '[]'::jsonb,
  active_tab_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operator_dashboards enable row level security;

-- Operator-only: a row is owned by exactly one user; only that user reads/writes it.
create policy "own row select" on public.operator_dashboards
  for select using (auth.uid() = user_id);
create policy "own row insert" on public.operator_dashboards
  for insert with check (auth.uid() = user_id);
create policy "own row update" on public.operator_dashboards
  for update using (auth.uid() = user_id);

create trigger trg_operator_dashboards_updated_at
  before update on public.operator_dashboards
  for each row execute function public.update_updated_at_column();
```

`tabs` shape (validated client-side, max 4):
```ts
type Widget = { id: string; kind: WidgetKind; props?: Record<string, unknown> };
type Tab = {
  id: string;            // ulid
  name: string;          // 1–24 chars
  template: TemplateId;  // see section 4
  widgets: (Widget | null)[]; // length matches template slot count
};
```

No realtime subscription on this table — saves are explicit and infrequent.

### 3. Widget contract

`src/components/dashboard/widgets/types.ts`:
```ts
export type WidgetKind =
  | "pending-approvals"
  | "night-observations-24h"
  | "open-risks"
  | "recent-capability-events";

export interface DashboardWidgetProps {
  size: "sm" | "md" | "lg";   // determined by the template slot
  onOpen?: () => void;        // navigates to the source page
}
```

Each widget is a small component in `src/components/dashboard/widgets/<Kind>Widget.tsx`. Rules:
- Self-contained: own data fetch via existing hooks/queries (no new tables).
- Header with title + a `→` icon that calls `onOpen`.
- Compact body sized for the slot. No internal scroll except for `lg`.
- Empty state is a single muted line.
- Errors degrade silently to a tiny "unavailable" line — never block the dashboard.

A `WidgetRegistry` maps `WidgetKind` → component + display label + default size + source route. The Add-Widget picker reads from this registry, so new widgets are one-line additions.

### 4. Bento templates (fixed, 4 presets)

```text
A. 2x2          B. 1+3              C. hero+strip       D. dense-6
┌────┬────┐     ┌─────────┬───┐     ┌──────────────┐    ┌──┬──┬──┐
│ md │ md │     │         │ sm│     │     lg       │    │sm│sm│sm│
├────┼────┤     │   lg    ├───┤     ├──┬──┬──┬─────┤    ├──┼──┼──┤
│ md │ md │     │         │ sm│     │sm│sm│sm│ sm  │    │sm│sm│sm│
└────┴────┘     │         ├───┤     └──┴──┴──┴─────┘    └──┴──┴──┘
                └─────────┴───┘
slots: 4 md     slots: 1 lg + 3 sm  slots: 1 lg + 4 sm  slots: 6 sm
```

Templates are CSS-grid layouts. Slots are positional — picking a template gives you that exact shape; you fill slots one by one.

### 5. Seeded widgets (v1)

| Kind                       | Source signal                                                           | Default size |
|----------------------------|-------------------------------------------------------------------------|--------------|
| `pending-approvals`        | `approval_queue` where `status = 'pending'` (reuse existing query)      | md           |
| `night-observations-24h`   | `night_observations` last 24h, count + most recent 3                    | md           |
| `open-risks`               | open high-severity risks (reuse `/roadmap/risks` query)                 | md           |
| `recent-capability-events` | latest 5 `capability_events`                                            | md           |

If a query isn't trivially available we **omit the widget** rather than build new infra — same rule as sidebar status dots.

### 6. Tab management

Header strip on `/dashboard`:
```text
[ Today ▾ ] [ Risk ] [ Delivery ] [ + ]    ⚙ edit
```

- Add tab (disabled at 4): prompts for name, defaults to template **A (2x2)**.
- Rename: inline edit on double-click or via edit menu.
- Delete: confirm dialog; cannot delete the last tab.
- Reorder: drag tab labels (simple HTML5 drag).
- Edit mode: toggles slot overlays so empty slots show **+ Add widget**, filled slots show **Replace** / **Remove**. Outside edit mode the dashboard is read-only and clean.
- Default seed (created on first visit when `operator_dashboards` row is missing): one tab named **Today**, template B (1+3), pre-filled with `pending-approvals` (lg) + `open-risks`, `night-observations-24h`, `recent-capability-events`.

### 7. Persistence

- `useDashboardConfig()` hook: loads/creates the user's row, exposes `{ tabs, activeTabId, save }`.
- All edits update local state immediately and debounce a single `update` to the row at 800ms idle. Tab switches are saved immediately (cheap field).
- No optimistic locking; one operator per row, last-write-wins is fine.

### 8. Files

**New**
- `supabase/migrations/<ts>_operator_dashboards.sql` (via migration tool)
- `src/pages/Dashboard.tsx`
- `src/hooks/useDashboardConfig.ts`
- `src/components/dashboard/DashboardTabs.tsx`
- `src/components/dashboard/BentoGrid.tsx` (renders a template + slot children)
- `src/components/dashboard/AddWidgetMenu.tsx`
- `src/components/dashboard/widgets/types.ts`
- `src/components/dashboard/widgets/registry.ts`
- `src/components/dashboard/widgets/PendingApprovalsWidget.tsx`
- `src/components/dashboard/widgets/NightObservationsWidget.tsx`
- `src/components/dashboard/widgets/OpenRisksWidget.tsx`
- `src/components/dashboard/widgets/RecentCapabilityEventsWidget.tsx`
- `docs/operator-dashboard.md`

**Edited**
- `src/App.tsx` — register `/dashboard` route.
- `src/components/AppSidebar.tsx` — add Dashboard at top of Operate.
- `README.md`, `CHANGELOG.md` — short entries.

### 9. Out of scope

- No drag-and-drop widget reordering inside a slot (slots are fixed positions for v1).
- No custom user-defined templates; just the four presets.
- No widget settings/props UI; widgets render with defaults only.
- No realtime sync of dashboard config across tabs/sessions.
- No widgets sourced from new queries — strictly reuse existing ones.
- No change to `/` or initial-route redirects.

### 10. Validation

- First visit creates the seed Today tab; reload restores it.
- Add a tab → at-cap state correctly disables the `+` button at 4.
- Switch templates on a tab → existing widgets remap to lower slot indexes; widgets that no longer fit are dropped with a confirm.
- Open a different browser → same operator sees identical tabs (server persistence).
- Insert a row into `approval_queue` → Pending approvals widget reflects it after its own subscription tick (widget owns its data).
- Delete the only tab → blocked with toast.
