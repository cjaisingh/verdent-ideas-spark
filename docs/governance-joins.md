# Governance Joins (W7.1.5)

The first measurable bridge between the four substrates AWIP already has:

- **Master Plan** (`roadmap_tasks`) — verbs
- **Ontology** (`docs/ontology.md` + `/ontology`) — nouns
- **Notebook** (`notebook_entries`) — reasoning
- **Decision Authority** (`decision_authorities`) — arbitration rules

Until now each lived alone. `governance_links` connects them.

## Schema

`public.governance_links` is generic many-to-many:

| column | type | notes |
|---|---|---|
| left_kind, right_kind | text | one of `task` \| `notebook` \| `entity` \| `authority_rule` |
| left_ref, right_ref | text | uuid for task/notebook/rule; entity name for entity |
| relation | text | `touches` \| `justifies` \| `governs` \| `supersedes` |
| created_by | uuid | actor |
| created_at | timestamptz | default `now()` |

Unique on `(left_kind, left_ref, right_kind, right_ref, relation)`. RLS: operator-only read+write.

`public.governance_link_events` is the append-only audit log. Trigger `trg_log_governance_link_event` writes one row per insert/delete.

## Relations

| relation | meaning |
|---|---|
| `touches` | task → entity it mutates |
| `justifies` | notebook → task or entity it explains |
| `governs` | authority_rule → entity it arbitrates (usually implicit via `decision_authorities`) |
| `supersedes` | newer notebook/rule → older one it replaces |

## Functions

### `governance_chain(_anchor_kind, _anchor_ref) → jsonb`

Returns the link graph for an anchor up to depth 2, plus a `gaps` array. For `task` anchors the expected legs are `entity`, `notebook`, `authority_rule` — anything missing shows up in `gaps`.

```jsonc
{
  "anchor_kind": "task",
  "anchor_ref": "<uuid>",
  "depth1": [...],
  "depth2": [...],
  "gaps": ["notebook"]
}
```

### `governance_coverage(_days) → jsonb`

Rolls up shipped tasks in the window and counts how many have an entity link, a notebook link, and an authority-rule link via their entity. Powers the `/governance` rollup card.

## Surface

- `/governance` — anchor picker, chain view, coverage rollup, add/remove link dialog.
- `/ontology` entity cards link to `/governance?kind=entity&ref=<entity>`.
- (follow-up) Add the same deep-link from notebook entries and roadmap task rows.

## What this is **not**

- Not enforcement. A task with zero links still ships.
- Not auto-inferred. Links are manual to keep the signal honest.
- Not historical. Coverage starts at 0% on day one — that is the point.

## Sequencing

1. W7.1.5 (this) — joins + coverage. Makes the holes visible.
2. W7.2 — claims pipeline + write-time enforcement against `decision_authorities`.
3. W7.3 — promote frequently-linked notebook entries into typed decision records.
4. W7.4 — confidence/decay model on the claims pipeline.

## Uncovered-tasks worklist

`/governance` now leads with an **Uncovered shipped tasks** panel backed by:

```sql
public.governance_uncovered_tasks(_days int default 30, _missing text default 'any')
-- _missing ∈ {'entity','notebook','authority_rule','any'}
-- operator/admin only; limit 200; ordered by updated_at desc
```

Filter chips toggle the `_missing` argument (Any gap / Missing entity / Missing notebook / Missing rule) and window (7/30/90d). Each row shows three coverage pills (`ent` / `nb` / `rule`). Clicking a row:

1. Sets the page anchor to that task.
2. Scrolls to the Anchor card.
3. Opens `AddLinkDialog` with `initialToKind` pre-selected to the first missing leg (entity → rule → notebook).

Realtime on `governance_links` means linked tasks drop out of the queue within ~1s. No bulk linking, no auto-inference — the friction is the point.
