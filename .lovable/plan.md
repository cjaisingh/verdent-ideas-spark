## Sidebar redesign: #1 base + Favorites (#2) + status dots (#6), with a collapsible Copilot subgroup

Goal: keep the current light-mode structure (#1) as the foundation, add a per-user **Favorites** pin section at the top (from #2), add **status dots** as the only secondary signal on rows (from #6), and collapse the five flat Copilot rows into one expandable subgroup under **Operate** (Option A). Single restrained palette — no glow, no decorative lines, no multi-color icons.

Pure UI work in `src/components/AppSidebar.tsx` and a small localStorage helper. No routes, no DB, no backend.

### 1. Visual rules (apply to every row)

- One unmistakable treatment for the active route: `bg-sidebar-accent text-sidebar-accent-foreground` + 2px left border in `--sidebar-primary`. Nothing else gets a fill.
- Icons: monochrome, `text-sidebar-foreground/70` default, `text-sidebar-primary` when active. No pastels, no gradients, no per-row colors.
- Status dot (right-aligned, 6px): `bg-destructive` (red), `bg-amber-500` (yellow), `bg-sky-500` (blue), `bg-emerald-500` (green). Source described in section 4. Dot is the only non-grey element on inactive rows.
- Group labels: small uppercase tracked, muted. No squiggles, no rules between groups beyond the existing `SidebarGroup` spacing.
- Tooltips show full label + status reason when collapsed/icon mode.

### 2. New top section: Favorites

Pinned by the operator, max 6 items, drag-to-reorder later (out of scope now — manual pin/unpin only).

```text
FAVORITES
  ☆ Tenants                ●
  ☆ Risk dashboard         ●
  ☆ Copilot transcripts
OPERATE
  ...
```

- Pin/unpin via a star button revealed on hover at the right of any nav row in the lower groups.
- Pinned rows in Favorites show the same icon + label + status dot as the source row. They do **not** get hidden from their original group — instead the original row shows a small filled star to indicate "pinned" (addresses the #2 "Copilot appearing twice is confusing" critique by keeping the duplicate intentional and visually marked).
- Empty state: section hidden entirely when no favorites.
- Persistence: `localStorage` key `awip.sidebar.favorites.v1` → `{ urls: string[] }`. Per-browser, per-user is fine for v1; server sync is a follow-up if asked.

### 3. Copilot subgroup (Option A)

Inside **Operate**, replace the five flat Copilot rows with one collapsible row:

```text
OPERATE
  Tenants
  Capabilities
  Events
  API logs
  Control plane
  ▸ Copilot                          ← chevron toggles, click label routes
      Agents
      Profile
      Lessons
      Transcripts
```

- Top-level **Copilot** row: clicking the label navigates to `/copilot` (or to last-visited child if any, stored at `awip.sidebar.copilot.lastChild`). Clicking the chevron toggles open/closed without navigating.
- Open-by-default if the current route starts with `/copilot`.
- Open/closed state persisted at `awip.sidebar.copilot.open`.
- Active state on a child also lights up the parent row with a thin left border (no fill) so the user can see "you're inside Copilot" at a glance.
- In icon-collapsed sidebar mode: parent shows the Copilot icon only; hovering surfaces a flyout with the four children.

### 4. Status dots — fixed mapping for v1

Driven by lightweight signals already available in the app (no new tables). Each dot has one and only one source:

| Row              | Dot       | Source signal                                                          |
|------------------|-----------|------------------------------------------------------------------------|
| Tenants          | red       | any tenant with `status = 'error'` (existing query, reuse hook)        |
| API logs         | red       | unread error-level logs in last 1h (existing realtime channel)         |
| Risk dashboard   | yellow    | open risks with severity ≥ high (reuse existing count)                 |
| Jobs board       | blue      | jobs in `pending` state assigned to current operator                   |
| Night shifts     | green     | currently inside the 22:00–06:00 UTC window AND any `night_observations` row in last 30min |
| Approval-related | reuse `PendingApprovalsIndicator` count, but render as a dot not a number |

If the source query isn't trivially available from existing hooks, **omit the dot** for that row in v1 rather than build new queries. Better to ship 3 truthful dots than 6 speculative ones.

### 5. Icon de-duplication (Copilot group)

Current state: Copilot, Copilot agents, Copilot profile, lessons, transcripts share or recycle icons. New mapping:

| Item            | Icon (lucide)      |
|-----------------|--------------------|
| Copilot (parent)| `Mic`              |
| Agents          | `Users`            |
| Profile         | `UserCircle2`      |
| Lessons         | `GraduationCap`    |
| Transcripts     | `MessageSquareText`|

(Mic stays only on the parent.)

### 6. Files

**Edited**
- `src/components/AppSidebar.tsx` — add Favorites section, collapsible Copilot subgroup, star pin/unpin button, status dot rendering, icon swap.

**New**
- `src/lib/sidebar-state.ts` — `useFavorites()` (localStorage), `useCopilotOpen()`, `useStatusDots()` (returns a `Record<url, "red"|"amber"|"blue"|"green">`, wires existing hooks/queries; rows without a known signal return `undefined`).
- `docs/operator-sidebar.md` — short doc: section order, pin behavior, dot mapping, how to add a new dot source.

**Updated docs**
- `README.md` — one bullet under "Operator console" mentioning Favorites + Copilot grouping.
- `CHANGELOG.md` — entry under Unreleased.

### 7. Out of scope

- No server-side persistence for favorites or Copilot open state (localStorage only).
- No drag-to-reorder favorites.
- No new status-dot data sources beyond what existing hooks already expose.
- No changes to the right/bottom panes, header, or any route.
- No dark-mode-only treatment — both themes use the same restrained palette.

### 8. Validation

- Pin Tenants → appears at top under FAVORITES with a status dot mirroring the original row; original Tenants row shows a filled star.
- Click chevron on Copilot → expands; click label → navigates to `/copilot`; visit `/copilot/lessons` → group auto-opens, parent row shows left-border-only active hint, Lessons row shows full active treatment.
- Reload → favorites and Copilot open state restored.
- Trigger an error log → red dot appears on API logs row within the realtime tick.
- Collapse sidebar to icon mode → Copilot parent flyout shows the four children with distinct icons; no row has more than one visual treatment at a time.
