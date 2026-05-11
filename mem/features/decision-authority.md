---
name: Decision Authority (W7.1)
description: decision_authorities table + resolve_truth() — per-entity per-field arbitration ruleset; operator>ai default, CI hard-owns TestRun, system hard-owns CapabilityEvent
type: feature
---

Truth arbitration substrate. Tables: `decision_authorities` (rules), `decision_authority_events` (audit). Function: `resolve_truth(entity, entity_id, field) → jsonb` returns ranked rules; v0 has no claims pipeline so `winner` is always null with `status: 'no-claims-yet'`.

Lower `precedence` wins. Field-specific rules beat `*` rules at the same precedence. `override_policy`: `hard` (immutable), `operator_only` (only operator overrides), `soft`.

Rules are git-versioned. To change one: write migration with `INSERT … ON CONFLICT DO UPDATE` on `decision_authorities`, add CHANGELOG entry under W7. No editing UI by design — same pattern as ontology.

Read-only surface at `/ontology` (DecisionAuthorityCard). Operator-only RLS, realtime on.

Next slices: W7.2 = `truth_claims` + ingestion (fills in `winner`); W7.3 = confidence decay; W7.4 = operator reliability history.

See `docs/decision-authority.md`.
