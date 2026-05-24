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
- `e2e/resolver.test.ts` — edge-fn level (entity-resolve); covers s5.1 deterministic path, s5.2 ancestry/scoring, s5.3 M2 lifecycle, M3 embedding hint, and M4 hard-revoke admin gating + `soft_revoke_idempotent` + cross-tenant 422.
- `e2e-playwright/entities-aliases.spec.ts` — operator UI smoke for `/entities/aliases`: page renders, admin-required banner appears for non-admin, Merge/Split disabled until tenant id entered.

## s5.3 M4 close-out (2026-05-24, batch A+D)

- Admin-gated `/entities/aliases` operator surface — all writes go through `entity-resolve`; never direct table writes.
- `scripts/adr-bench/adr-0004-revocation.ts --write-decision` patches ADR-0004 with a `Bench decision` block. Status flip to `accepted` is gated on `alias_row_count >= 1000`.
- **`alias_corpus_ready` sentinel check** (kind, severity `info`, dedupe key `alias_corpus_ready`) fires once when `tenant_node_aliases` count crosses 1000. Corpus is **1100** as of 2026-05-24 — the next `sentinel-tick` run will surface this finding on /admin/sentinel-findings, auto-nudging the ADR-0004 bench. Source: `checkAliasCorpusReady()` in `supabase/functions/sentinel-tick/checks.ts`.

## Out of scope (deferred)

- True scoring with weighted combination of multiple descriptors (Phase 5 s5.2 corpus tuning).
- `/governance` UI card for `v_resolver_decisions_summary` — defer until live tenant data exists.
- Fact-side cascade (`canonical_facts.binding_status`, staged re-quarantine, KR grey-out) — Phase 6.
- `resolve_truth()` wiring for resolver `conflict_open` events — W7.2 task already open.
- Telegram routing for `alias_revoke_burst` — owed chat-first checklist, separate task.
