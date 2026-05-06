
## Revised Roadmap view: Tree + Timeline (no Gantt)

Replace the earlier "collapsible list" sketch with a two-pane combo that mirrors your references.

```text
┌──────────────────────────────┬──────────────────────────────────────────┐
│  TREE (left, ~38%)           │  TIMELINE (right, fills rest)            │
│                              │                                          │
│  ▼ ☑ Phase 1  Core           │     ●  2026-05-06  Phase 1 done          │
│      ▼ ☑ Sprint 1.1          │     │                                    │
│          ☑ Migration         │     ●  2026-05-06  /approvals contract   │
│          ☑ /approvals API    │     │                                    │
│          ☑ UI cutover        │  ⏱ ●  now         Sprint 2.1 in progress │
│  ▼ ◧ Phase 2  operator_ch.   │     │              "register endpoint"   │
│      ▼ ◧ Sprint 2.1 Scaffold │     │                                    │
│          ☑ README            │     ○  todo        approval-callback     │
│          ◧ register endpoint │     │              💬 2 questions        │
│          ☐ approval-callback │     ○  todo        Sprint 2.2 Telegram   │
│      ▶ ☐ Sprint 2.2 Telegram │     │                                    │
│  ▶ ☐ Phase 3  Cutover        │     ○  planned     Phase 3 Cutover       │
│  ▶ ☐ Phase 4  Voice          │     ○  planned     Phase 4 Voice         │
└──────────────────────────────┴──────────────────────────────────────────┘
```

### Left pane — Tree with tri-state checkboxes (ref: image 1)

- Phase → Sprint → Task hierarchy, collapsible at every level.
- Checkbox states map to status:
  - `☐` empty = `todo`
  - `◧` indeterminate = some children done / `in_progress`
  - `☑` checked = `done`
  - dimmed = `wont_do` / `paused`
- Clicking a row selects it and scrolls the timeline to the matching marker; clicking the checkbox toggles status (operator only).
- Drag to reorder within a parent.
- Badges on the row: 💬 comment count, 🚧 blocked, 👤 owner initials.
- Built on Radix `Collapsible` + custom tri-state checkbox (no new dep).

### Right pane — Vertical timeline (ref: image 2)

- One marker per task, ordered by `order` within sprint, sprints stacked under their phase header.
- Marker style by status:
  - blue ring `○` = todo / planned
  - green filled `●` = done
  - clock `⏱` = in_progress
  - red ring = blocked
- Each marker shows: relative date (created/updated/decided), one-line title, and — when expanded — description, acceptance criteria, comment thread.
- Clicking a marker selects it and highlights the matching tree row.
- Sticky "Now" line between last `done` and first `in_progress`/`todo`. The "Next up" pill from earlier sits on this line.
- Filter chips above the timeline: All / Active phase only / My tasks / Has questions.

### Sync behaviour

- Selection is shared state — tree ⇄ timeline.
- Realtime subscription on `roadmap_tasks` and `roadmap_comments` updates both panes without reload.
- Collapse state persists in `localStorage` per user.

### What stays the same as the previous plan

- Tables: `roadmap_phases`, `roadmap_sprints`, `roadmap_tasks`, `roadmap_comments`.
- Edge function `roadmap-api` with `/tasks/:id/status`, `/tasks/:id/comment`, `/next`.
- Seeded from `.lovable/plan.md` so Phases 1–4 + the operator_channel sprints/tasks are present immediately.
- Mounted as a new tab on `/control-plane` ("Roadmap"), alongside Demand and Feed.
- Optional Linear mirror deferred.

### What changes vs the previous plan

- Drop the flat collapsible list. Build the two-pane Tree+Timeline instead.
- Add `parent_path` virtualisation so deeply-nested trees stay performant (we won't go past 3 levels for now, so this is just future-proofing — no extra column needed).
- Side panel for task detail becomes the *expanded timeline marker* — no separate drawer, fewer clicks.

### Out of scope (still)

- Gantt / horizontal time axis.
- Calendar dates on every task (only sprints have `starts_on`/`ends_on`; tasks just show created/updated).
- Cross-phase dependency arrows on the timeline (blocked-by shown as a chip on the row, not a line).

Approve and I'll build Phase 1 (schema + seed + read-only Tree+Timeline) and Phase 2 (editing + comments + realtime) in one pass.
