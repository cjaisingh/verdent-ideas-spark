# ADR-0004: Alias revocation cascade semantics

- **Status:** proposed
- **Date:** 2026-05-21

## Context

Phase 5 makes `tenant_node_aliases` first-class and operator-approved. Inevitably some aliases turn out to be wrong (typo, merger reassigns an asset, vendor reused a code). Revoking an alias means previously-bound `canonical_facts` rows are now resting on a stale binding.

Three cascade options:

1. **Soft flag** — set `alias.revoked_at`; mark previously-bound facts with `binding_status='stale'`; OKR rollups continue but surface a "stale binding" badge.
2. **Hard re-quarantine** — move every affected fact back to `staged_records`; KRs go grey until re-resolved; forces fast operator action but blocks dashboards.
3. **Hybrid** — soft flag by default; admin-only "hard revoke" for security/compliance-driven removals (e.g. wrong tenant binding, GDPR rectification).

## Decision

**TBD** — decide when sprint `s5.3` opens. Trigger: first revocation in anger plus a count of "facts that would be affected" from production-shaped data.

Current lean: option 3 (hybrid). Soft flag covers the everyday "we got the alias wrong" case; hard revoke is the escape hatch for compliance.

## Consequences

To be filled in once the decision lands. Whichever option wins, revocation must emit an `okr_node_event` so OKR owners can see why a rollup just changed.
