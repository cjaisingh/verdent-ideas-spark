---
name: Entity resolver (Phase 5 s5.1)
description: tenant_nodes/aliases/conflicts/events + entity-resolve edge fn for tenant-scoped entity resolution
type: feature
---
Phase 5 sprint s5.1 substrate — first cut of the entity resolver.

## Hard invariants
- Resolver never crosses `tenant_id` — every query carries it; e2e cross-tenant gate test enforces this.
- Aliases are explicit + operator-approved + revocable (`revoked_at`). Unique on `(tenant_id, kind, normalised) where revoked_at is null`.
- Authoritative IDs (`bim_ifc_guid`, `rics_id`, `os_uprn`, `sap_floc`, or any descriptor with `authoritative:true`) short-circuit and force `authoritativeHit=true`. Caller MUST auto-bind.
- Every write on `tenant_nodes` / `tenant_node_aliases` emits an `entity_resolution_events` row (trigger).

## Tables
- `public.tenant_nodes` (parent_id, kind, name, external_ids jsonb, status enum, superseded_by) — admin-only RLS, realtime.
- `public.tenant_node_aliases` (kind enum, value, generated `normalised`, source, authoritative, approved_by/at, revoked_at) — admin-only RLS, realtime, FTS index on `normalised`.
- `public.entity_resolution_conflicts` (descriptors, candidates, status enum, resolved_by/at) — admin writes, operator reads.
- `public.entity_resolution_events` (kind enum: propose/bind/alias_create/alias_revoke/conflict_open/conflict_resolve/node_upsert, payload, actor, request_id) — service-role writes only.

## Edge fn `entity-resolve` (POST)
- `/resolve` — `ResolverRetrievalInputSchema` → `ResolverRetrievalOutput`. Match order: authoritative → alias_exact → alias_fts. embedding_hint is s5.2.
- `/bind` — bulk descriptor → node bind, Idempotency-Key required, emits `bind` event.
- `/alias/create` — single alias, Idempotency-Key required, idempotent on `(tenant_id, kind, normalised)`.
- Auth: operator JWT (operator/admin role) OR `x-service-token`.
- Logger: wrapped with `withLogger("entity-resolve")`. Registered in `observability_registry`.

## UI
`/entities` (sidebar Knowledge group) — read-only probe form: tenant UUID + JSON descriptors → candidates list with score, matchSource, ancestry.

## s5.2 (landed 2026-05-21)
- `tenant_nodes.ancestry_ids uuid[]` + GIN `idx_tenant_nodes_ancestry`; `BEFORE` trigger `tg_tenant_nodes_set_ancestry` keeps it via recursive CTE (depth cap 32). Resolver returns ancestry from the array, no parent_id walk.
- `descriptor_weights` (tenant-scoped, admin RLS) drives FTS scoring; seeds: authoritative kinds = 1.0, postcode = 0.9, name/address = 0.7.
- Confidence bands: `auto_bind` >=0.85, `conflict` 0.55-0.85, `no_match` <0.55. `conflict` band emits `conflict_open` event.
- `v_resolver_health` view + `resolver_low_confidence_rate` sentinel check (>20% no_match over 24h, min 20 events).
- ADR-0003 stays `proposed`: implemented lean, but status flip blocked until a real tenant tree (>=5k nodes) lands per `docs/adr/benchmarks.md`. Baseline bench row in `adr_bench_results`.

## Out of scope (lands in s5.3)
- embedding_hint last-resort match (needs alias-embedding store)
- alias revoke + merge/split lifecycle (ADR-0004 flip)
- per-tenant `descriptor_weights` editing UI
- `resolve_truth()` wiring for resolver conflicts

## Tests
`e2e/resolver.test.ts` — cross-tenant gate (hard invariant), alias_exact precedence, authoritative short-circuit, revoked invisible, idempotency-key required, weighted scoring, ancestry parity, all three confidence bands.


## s5.3 — alias lifecycle (M1+M2, landed 2026-05-21)

**Schema (M1).** `tenant_node_aliases` carries `supersedes_alias_id`, `merge_group_id`, `hard_revoked`, `revoke_reason` (constraint: hard-revoke needs ≥8-char reason). Enum extended with `alias_merge`, `alias_split`, `alias_hard_revoke`. New `tenant_node_alias_embeddings(vector(1536), HNSW cosine, admin RLS, realtime)`. Helper `tenant_node_alias_effective(uuid)` follows supersedes chain. View `v_alias_lineage_health` per tenant.

**Endpoints (M2).** All three require `Idempotency-Key`. Replays short-circuit before mutation (`{ idempotent: true }`). Cross-tenant ops → 422 `cross_tenant_rejected`.

- `/alias/revoke` — soft by default. `hardRevoke=true` is admin-only (`has_role('admin')`); service-token has admin powers. Emits `alias_revoke` or `alias_hard_revoke` with `request_id`, `reason`, `hard_revoke` in payload.
- `/alias/merge` — N→1. New canonical alias on `intoNodeId` shares `merge_group_id = sha256("merge:" + idem_key)` with every source; sources get `revoked_at`, `revoke_reason`, `supersedes_alias_id = new`. One `alias_merge` event with `old_alias_ids[]` + `new_alias_id` + `into_node_id` in payload.
- `/alias/split` — 1→N. Source revoked; N new aliases inserted with `supersedes_alias_id = sourceAliasId`. One `alias_split` event with `source_alias_id` + `new_alias_ids[]` + `target_node_ids[]` in payload.

**What still ships in s5.3.** M3: embedding-hint last-resort branch on `/resolve` (cap 0.6, never auto-bind) + `alias_revoke_burst` sentinel (>10/h/tenant medium). M4: `/entities/aliases` admin UI. M5: `adr-0004-revocation` bench + ADR-0004 status flip per `docs/adr/benchmarks.md`. Fact-side cascade (`binding_status`, KR grey-out) defers to Phase 6 §6.x.
