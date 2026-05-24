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

> Benchmark + dataset requirements: see [`docs/adr/benchmarks.md § ADR-0004`](./benchmarks.md#adr-0004--alias-revocation-cascade).

## Consequences

To be filled in once the decision lands. Whichever option wins, revocation must emit an `okr_node_event` so OKR owners can see why a rollup just changed.

## Acceptance (s5.3 M3/M4)

Decision is locked to **option 3 (hybrid)**: soft revoke by default, admin-only `hardRevoke=true` with `reason.length >= 8` enforced by `tenant_node_aliases_hard_revoke_reason_chk`. Lookup performance must hold on the resolver hot path, gated by this checklist:

| Condition (from `scripts/adr-bench/adr-0004-revocation.ts`) | Action |
|---|---|
| `lookup_p95_ms ≤ 15` at current corpus | Keep in-table — no change needed. |
| `15 < lookup_p95_ms ≤ 40` | Add `BRIN` index on `revoked_at` and re-bench. |
| `lookup_p95_ms > 40` OR write amplification > 2× baseline | Flip to `mv_active_aliases` materialised view, refreshed on `entity_resolution_events` trigger, gated behind feature flag `resolver.use_mv_aliases`. |
| `compliance_revocation_count_30d == 0` over 90d | Drop the hard path. Revisit at end of Phase 5. |

Bench JSON lands in `bench-results/adr-0004-<timestamp>.json` and uploads to `public.adr_bench_results` (`tripped_triggers` reflects which row above the run matched). CHANGELOG entry records the chosen branch.

### M3/M4 milestones

- **M3** — embedding-hint branch on `/resolve` (cap 0.6, skipped when authoritative descriptor hits or topK full); `alias_revoke_burst` sentinel check (>10 in 15min/tenant → high; ≥3 hard → critical); `idx_alias_tenant_revoked` index added.
- **M4** — admin-role JWT harness for `alias_hard_revoke_requires_admin_role` test; first acceptance bench run; ADR-0004 Consequences section finalised and `mem://features/entity-resolver` updated with the chosen branch.

### M4 status (2026-05-22)

- **Admin JWT harness:** shipped. `e2e/resolver.test.ts > entity-resolve — s5.3 M4 hard-revoke admin gating` exercises three users (anon, operator-only, operator+admin) against `/alias/revoke?hardRevoke=true`. Requires `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` secrets; tests skip individually when fixture absent.
- **Operator admin surface:** `/entities/aliases` ships an operator-only list + revoke / hard-revoke / merge / split form, calling `entity-resolve` only (no direct table writes).
- **Acceptance bench:** **deferred** — current `tenant_node_aliases` corpus = 0 rows. Bench would record only network-round-trip latency. Status stays **proposed**; flip to **accepted** when corpus ≥ 1 000 aliases (sentinel `alias_corpus_ready` to be added under chat-first when relevant). Until then, the decision tree above is *contingent*; no row is annotated as matched.
- **`--write-decision` flag (2026-05-24):** `bun scripts/adr-bench/adr-0004-revocation.ts --write-decision` patches this file in place — appends a `Bench decision` block with chosen branch + p95 + dataset hash, and flips `Status: proposed → accepted` ONLY when `alias_row_count >= 1000`. Idempotent (block keyed by HTML comment). Until corpus is meaningful the flag writes the block but leaves status untouched.
