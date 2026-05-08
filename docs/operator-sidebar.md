# Operator sidebar

The left navigation in `src/components/AppSidebar.tsx` follows three rules:

1. **One active treatment per row.** The current route gets `bg-sidebar-accent` plus a 2px `--sidebar-primary` left border. Nothing else is filled. When the active route is a Copilot child, the parent row also shows a thinner left border (no fill) so you can see "you're inside Copilot" at a glance.
2. **Monochrome icons.** Default `text-sidebar-foreground/70`, active `text-sidebar-primary`. No pastels, gradients, or per-row colors.
3. **Status dots are the only secondary signal.** A 6px dot on the right of a row, drawn only when there is a real, lightweight signal behind it (see below).

## Sections

```
FAVORITES   (only when the operator has pinned at least one route)
OPERATE
  Tenants, Capabilities, Events, API logs, Control plane
  ▸ Copilot                              (collapsible subgroup)
      Agents, Profile, Lessons, Transcripts
PLAN
SYSTEM
```

## Favorites

- Hover any row in Operate / Plan / System to reveal a star button. Click to pin (max 6).
- Pinned rows appear at the top under FAVORITES with the same icon + label + dot as the source row.
- The original row stays visible and shows a small filled star, so the duplicate is intentional and obvious.
- Persisted in `localStorage` under `awip.sidebar.favorites.v1` (per-browser, per-user).

## Copilot subgroup

- Clicking the **Copilot** label navigates to `/copilot` (or to the last visited child if any — stored at `awip.sidebar.copilot.lastChild`).
- Clicking the chevron toggles the subgroup without navigating; open/closed state is persisted at `awip.sidebar.copilot.open`.
- Auto-opens whenever the route starts with `/copilot`.

## Status dots

Driven by `useStatusDots()` in `src/lib/sidebar-state.ts`. Each row gets at most one dot.

| Color  | Class            | Meaning             |
|--------|------------------|---------------------|
| red    | `bg-destructive` | needs attention     |
| amber  | `bg-amber-500`   | awaiting action     |
| blue   | `bg-sky-500`     | in progress         |
| green  | `bg-emerald-500` | active              |

Current sources:

| Route          | Dot          | Source                                                              |
|----------------|--------------|---------------------------------------------------------------------|
| `/admin`       | amber / red  | pending rows in `approval_queue` (red when > 5)                     |
| `/night-shifts`| green        | any `night_observations` row in the last 30 minutes                 |

To add a new dot source, extend `useStatusDots()` with a query that already exists in the app and add a row to the table above. **Do not** invent a query just to light up a dot — better to ship fewer truthful dots than many speculative ones.
