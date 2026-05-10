## Problem

Sidebar lists ~35 flat items across 4 long groups. New pages (`/reviews`, `/walkthrough`, `/master-plan`) aren't in the nav at all, and several items overlap (e.g. `/ai-usage` vs `/admin/ai-usage`, `/runbook` vs `/runbooks`, `/admin/lessons` vs `/copilot/lessons`). The "Plan" group alone has 14 entries which is the main source of fatigue.

## Goals

1. Every route in `App.tsx` is reachable from the sidebar.
2. Top-level groups stay scannable (≤7 visible items each by default).
3. Power-user pages (admin, explorers, deep audits) are tucked behind collapsible subgroups so they don't dominate the rail.
4. No route changes, no page changes — sidebar reorg only.

## Proposed structure

Five groups, with collapsible subgroups for the long tails. Items in **bold** are currently missing from the nav.

```text
FAVORITES                       (unchanged — user-pinned)

OPERATE
  Dashboard
  Tenants
  Capabilities
  Events
  Control plane
  ▸ Logs & data            (collapsed by default)
      API logs
      API explorer
      DB explorer
      DB audit log

PLAN & ROADMAP
  Morning Review
  Roadmap
  Risk dashboard
  Approval pack
  Jobs board
  Plan (workstreams)
  **Master plan**
  ▸ Knowledge             (collapsed)
      Notebook
      Runbook
      Runbooks
      Memory
      Lessons Loop

COPILOT & AUTOMATION
  Companion
  Copilot ▸ (existing submenu: Agents / Profile / Lessons / Transcripts)
  Overnight overview
  Night shifts
  **App walkthrough**
  **External weekly reviews**
  Deep audits
  AI usage & cost

SYSTEM & ADMIN                  (whole group collapsed by default)
  Admin
  Status
  Capability promotion
  Promotion audits
  Cron health
  Automation schedules
  Logs
  AI usage (admin)
```

Net effect: default-visible item count drops from ~35 to ~22, and all routes are reachable.

## De-duplication notes (labels only, no route changes)

- `/ai-usage` → "AI usage & cost" (operator view), `/admin/ai-usage` → "AI usage (admin)" — kept distinct by suffix.
- `/runbook` → "Runbook (active)", `/runbooks` → "Runbook library" — clarifies the singular vs plural pair.
- `/copilot/lessons` stays under Copilot; `/admin/lessons` is renamed "Lessons Loop (weekly)" so the difference is obvious.

## Technical changes

Single file: `src/components/AppSidebar.tsx`.

1. Restructure the `NavItem` arrays into the five groups above; add `masterPlanItem`, `walkthroughItem`, `reviewsItem`.
2. Introduce a small `CollapsibleGroup` helper (mirroring the existing Copilot expand/collapse pattern using `SidebarMenuSub`) for the new "Logs & data", "Knowledge", and "System & admin" subgroups. Persist open/closed state in the same `sidebar-state` store that already handles `useCopilotOpen` (add `useGroupOpen(key, defaultOpen)`).
3. `allItems` (used for favorites lookup) gets the three new entries so they can be pinned.
4. No route, page, RLS, edge function, or memory changes.

## Out of scope

- Renaming routes or moving pages.
- Touching the mobile/offcanvas behaviour beyond what falls out of the group restructure.
- Changing the Copilot submenu (already works well).

Approve this and I'll implement in `AppSidebar.tsx` + a small addition to `src/lib/sidebar-state.ts`.