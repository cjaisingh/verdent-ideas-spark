---
name: apex-objectives
description: 7 top-level client-goal Objectives seeded on the AWIP Platform tenant.
type: feature
---

The 7 apex client-goal Objectives from the constellation diagram are seeded as top-level `okr_nodes` (parent_id=NULL, kind='objective', status='active') on a dedicated **AWIP Platform** tenant (`tenants.slug='awip-platform'`, id `00000000-0000-0000-0000-000000000001`). They are platform-level, not customer-tenant-scoped:

1. Operational Excellence
2. Cost Efficiency
3. Risk Reduction
4. Workplace Experience
5. Sustainability & ESG
6. Compliance Confidence
7. Growth & Value Creation

Deterministic UUIDs `a0000001-0000-4000-8000-00000000000{1..7}`. Re-running the seed is a no-op.

**Authority:** git-versioned via migration/seed + CHANGELOG, no editing UI. Title/description changes go through a new seed PR, not direct UPDATE. Mirrors the `docs/ontology.md` discipline.

**Events:** `okr_node_events` rows are emitted manually at seed time (`event_type='created'`, `actor='operator:apex-seed'`) — note that `okr_nodes` has **no DB trigger** for event emission; the rule "every OKR mutation → okr_node_events" is enforced at the application layer (`awip-api /okr/ingest`). Any future direct DB writes to `okr_nodes` must emit the event themselves.

**KRs:** intentionally none yet. Operator authors KRs as real measurable targets emerge per `okr-strategist` rule.

**Related:** ADR-0003 (OKR-driven execution), `mem://features/ontology`, `mem://features/okr-value-layer`.
