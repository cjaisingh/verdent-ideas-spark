---
name: okr-value-layer
description: USD value columns on okr_nodes + discussion_actions; KR is authoritative, action override is fallback-only.
type: feature
---

`okr_nodes.projected_value_usd` + `okr_nodes.realized_value_usd` are the canonical home of "what is this outcome worth?" Both are nullable, operator-authoritative, **never AI-written without operator approval**.

`discussion_actions.projected_value_usd` + `realized_value_usd` exist as a fallback for one-off items not tied to a KR. When `discussion_actions.okr_node_id` (via parent task) is set, the KR value wins — action override is ignored to prevent double-counting.

**Rollup helper:** `src/lib/okrValue.ts → rollupActionValue(action, kr)` — returns `{projected, realized, source: "kr"|"action"|"none"}`.

**Why:** without a $-anchored signal, any future recommender ranks by activity, not impact. This makes the Advisor framing *possible* later without committing to a recommender now.

**Audit:** existing `emit_okr_node_event` + `discussion_action_events` triggers serialise the whole row, so column changes auto-flow into events. No new event work.

**Out of scope (parked):** Advisor recommender, surfacing on `/okr` or Morning Review, backfill of existing KRs, multi-currency.

**Related:** ADR-0003 (OKR-driven execution), `docs/okr-value-layer.md`, Klarity analysis takeaway #3 (chat 2026-05-25).
