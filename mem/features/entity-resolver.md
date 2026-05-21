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

## Out of scope this sprint (lands in s5.2/s5.3)
- ancestry materialisation (`ancestry_ids[]`) — currently walks parent_id chain per candidate
- per-tenant scoring weights (`descriptor_weights` table)
- embedding_hint last-resort match
- conflict approve/reject UI + `resolve_truth()` wiring
- alias revoke + merge/split flows

## Tests
`e2e/resolver.test.ts` — alias_exact wins, cross-tenant gate, authoritative short-circuit, revoked invisible, idempotency-key required.
