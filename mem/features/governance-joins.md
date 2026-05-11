---
name: governance-joins
description: governance_links + governance_chain + /governance page connecting tasks, notebooks, ontology entities, and decision authority rules
type: feature
---

W7.1.5 wires the four substrates together via a single generic many-to-many table `governance_links` (left_kind/left_ref/right_kind/right_ref/relation). Operator-only RLS, realtime on, audit log in `governance_link_events`.

Reader RPCs: `governance_chain(_anchor_kind, _anchor_ref)` returns depth-2 graph + `gaps[]`; `governance_coverage(_days)` returns tasks_shipped vs with_entity/with_notebook/with_authority_rule.

Surface: `/governance` page (anchor picker + chain + coverage + add/remove link dialog). Entity cards on `/ontology` deep-link via `?kind=entity&ref=<entity>`.

Relations: `touches` (task→entity), `justifies` (notebook→task|entity), `governs` (rule→entity), `supersedes` (newer→older).

What it is NOT: enforcement, auto-inference, historical backfill. Coverage starts at 0% by design — that is what creates pressure to ship W7.2 (claims pipeline + write-time enforcement).
