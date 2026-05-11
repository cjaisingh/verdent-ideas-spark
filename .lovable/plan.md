## W7.1.5 — Governance Joins (make the holes visible)

Before adding enforcement teeth (W7.2) or upgrading Notebook into a first-class linked store, build the **joins** between the four substrates we already have. The goal is one page where any operator can pick a roadmap task and see the full chain — *what entity it touches, what notebook reasoning justified it, which authority rule governs that entity, and whether the chain is complete.*

The value is diagnostic: the page will visibly **show** which links are missing on every change. That is what creates pressure to build W7.2 next, and it is the cheapest possible step that connects the three "weak-but-declarative" layers.

### What exists today

```text
roadmap_tasks      — verbs (work items)        [no entity link, no notebook link]
notebook_entries   — thoughts (markdown)       [no entity link, no task link, tags only]
ontology entities  — nouns (in docs/ontology.md, surfaced on /ontology)
decision_authorities — arbitration rules       [per (entity, field), read-only on /ontology]
```

Each lives on its own page. None of them know about each other.

### What ships

#### 1. Two thin link tables (no schema changes to existing tables)

`governance_links` — generic many-to-many between any two governance objects:

| column | type | notes |
|---|---|---|
| id | uuid | pk |
| left_kind | text | `task` \| `notebook` \| `entity` \| `authority_rule` |
| left_ref | text | uuid for task/notebook/rule; entity name (e.g. `OKR`) for entity |
| right_kind | text | same enum |
| right_ref | text | same |
| relation | text | `touches` \| `justifies` \| `governs` \| `supersedes` |
| created_by | uuid | auth.uid() |
| created_at | timestamptz | default now() |

Unique on `(left_kind, left_ref, right_kind, right_ref, relation)`. RLS: operator-only read+write.

`governance_link_events` — append-only audit, same shape as `decision_authority_events`.

Why generic instead of three specific FKs: we already have 4 governance object types and will add more (lessons, sentinel findings, audits). One table keeps the join surface flat and queryable; we can always migrate to typed tables later if a relation becomes load-bearing.

#### 2. One read function

`public.governance_chain(_anchor_kind text, _anchor_ref text) returns jsonb` — given any anchor (task / notebook / entity / rule), walks `governance_links` up to depth 2 and returns the full chain plus a `gaps` array listing the expected-but-missing legs (e.g. `task → entity` missing, `entity → authority_rule` missing). SECURITY DEFINER, operator-only.

The gap detector is the whole point: it converts "we have markdown" into "we have a measurable completeness number."

#### 3. `/governance` page

New route. Three panels:

```text
┌─────────────────────────────────────────────────────────────┐
│ Anchor picker:  [Task ▾] [Notebook ▾] [Entity ▾] [Rule ▾]  │
├─────────────────────────────────────────────────────────────┤
│ Chain graph (left→right)                                    │
│                                                             │
│  Task #142 ──touches──▶ OKR ──governed by──▶ rule#3        │
│       │                                                     │
│       └──justified by──▶ Notebook "Why we shipped W7.1"    │
│                                                             │
│ Gaps detected: 0                                            │
├─────────────────────────────────────────────────────────────┤
│ Coverage rollup (last 30 days)                              │
│   Tasks shipped:               42                           │
│   …with entity link:           11   (26%)  ← the hole       │
│   …with notebook justification: 6   (14%)  ← the hole       │
│   …entity has authority rule:  42   (100%) ← W7.1 covered   │
└─────────────────────────────────────────────────────────────┘
```

The coverage rollup is the daily metric that makes the gap operational. It belongs on `/morning-review` too (one extra card, deferred to a follow-up).

#### 4. Minimal "add link" affordance

On `/roadmap/task/:id`, `/notebook/:id`, and entity cards on `/ontology`, add a single "Linked governance" section with an inline "+ link" button that opens a small dialog (other-kind picker + relation dropdown). No bulk operations, no editing — just create/delete one link at a time. This keeps the surface area tiny.

#### 5. Docs + memory

- `docs/governance-joins.md` — what the link table is, what the four relations mean, how the chain function reads them, gap semantics.
- `mem/features/governance-joins.md` — one-liner index entry.
- `mem/index.md` Core line: "Governance chain: tasks→entities→rules + tasks→notebooks→entities; coverage at /governance."
- `CHANGELOG.md` entry under W7.1.5.

### What does NOT ship

- No backfill of historical links. Coverage starts at 0% on day one — that is the point.
- No enforcement. A task with zero links still ships. (W7.2 will add teeth once the gaps are visible.)
- No automatic link inference (e.g. "guess the entity from the task title"). Manual only — to keep the signal honest.
- No editing of `decision_authorities` from the UI (still git-managed).
- No new cron jobs.

### Verification

1. Migration applies cleanly; linter clean; RLS enforces operator-only.
2. `select governance_chain('task', '<some-task-uuid>')` returns the chain JSON with `gaps: ['entity','notebook']` for an unlinked task.
3. Create one link via the new dialog on `/roadmap/task/:id` → chain function returns `gaps: ['notebook']` only.
4. `/governance` page renders all three panels; coverage rollup matches a hand-counted SQL query on `governance_links`.
5. Existing `/ontology`, `/notebook`, `/roadmap` pages still render unchanged except for the small "Linked governance" section.
6. No new cron jobs, no edge-function changes, no edits to `model-policy.ts`.

### Why this slice, not W7.2 or Notebook-as-records

- **W7.2 (enforcement)** without joins would reject writes from "wrong" sources but operators would have no way to see *which decisions actually got made the right way historically*. Joins first, teeth second.
- **Notebook → linked records** would solve half the problem (notebook ↔ entity) but leave roadmap and authority orphaned. The generic link table covers all four with one migration.
- The coverage rollup gives the first **measurable governance metric**: "X% of tasks shipped this week have a recorded entity + justification + authority chain." That number is what tells us whether AWIP is actually being run as a governed system, or just one with governance theater.

### Sequencing after this

1. (this slice) W7.1.5 — joins + coverage
2. W7.2 — claims pipeline + write-time enforcement against `decision_authorities`
3. W7.3 — promote frequently-linked notebook entries into typed decision records
4. W7.4 — confidence/decay model on the claims pipeline
