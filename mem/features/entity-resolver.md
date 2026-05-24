---
name: Entity resolver
description: Phase 5 deterministic resolver (resolve_entity + resolve_entity_logged) with descriptor weights + decisions log + summary view
type: feature
---

## Core

Single chokepoint for tenant-scoped entity resolution. Pure SQL — no LLM.

- **`public.resolve_entity(_tenant_id uuid, _descriptors jsonb) → jsonb`** — `STABLE`, `SECURITY DEFINER`. Two-pass exact match on `tenant_node_aliases`:
  1. Authoritative pass: only descriptors with `resolver_descriptor_weights.weight >= 0.95` (`asset_code`, `bim_ifc_guid`, `os_uprn`, `rics_id`, `sap_floc`).
  2. Any-exact pass: any non-revoked alias match.
  Returns `{ winner_node_id, strategy, confidence, candidate_count, matched_kind?, authoritative_hit }`. Strategies: `exact_authoritative` / `exact_alias` / `no_match` / `no_descriptors`.
- **`public.resolve_entity_logged(_tenant_id, _descriptors, _request_id?, _actor_label?)`** — call this from edge fns / agents. Wraps `resolve_entity`, inserts into the existing `resolver_decisions` table (request_id, latency_ms, descriptors, winner, score, confidence_band, authoritative_hit, actor_label), and emits `tenant_node_events('resolve')` on a winner.
- **`confidence_band`** mapping: `>=0.95 → high`, `>=0.75 → medium`, `>0 → low`, else `none`.

## Tables

- `resolver_descriptor_weights (kind, weight, min_confidence, notes)` — operator-only, seeded with 9 alias_descriptor_kind values.
- `resolver_decisions` — existing table; logged wrapper writes here.
- `v_resolver_decisions_summary` — 7-day band rates, p50/p95 latency, top descriptor kinds.

## Sentinel

`resolver_decisions` is registered in `observability_registry` (1440-min cadence, `observability_stale_surface` watcher). The existing observability sentinel fires `medium` if writes stop for 24h once any tenant is live. No bespoke `resolver_decision_silence` kind.

## Tests

- `e2e/tenant-resolve-isolation.test.ts` — DB-level cross-tenant gate on `resolve_entity()`.
- `e2e/resolver.test.ts` — edge-fn level (entity-resolve), including alias merge/revoke cross-tenant rejections.

## Out of scope (deferred)

- True scoring with weighted combination of multiple descriptors (Phase 5 s5.2 corpus tuning).
- `/governance` UI card for `v_resolver_decisions_summary` — defer until live tenant data exists.
