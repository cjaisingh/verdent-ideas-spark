---
name: Retrieval contracts registry
description: Phase 6 s6.1/t0 — public.retrieval_contracts table declaring per-consumer retrieval shape, store, primary key, token budget, freshness window, fallback. Git-versioned, no UI.
type: feature
---

## Core

Every consumer surface (edge fn, cron, UI route, agent loop) that reads "knowledge" MUST have a row in `public.retrieval_contracts`. The row declares which of 5 shapes it consumes — `prose` / `hierarchical-doc` / `tabular` / `graph` / `relational` / `time-series` — before any store/vendor decision is made.

The point: stop us picking pgvector vs LanceDB vs DuckDB vs Neo4j before we know what each consumer actually needs.

## Schema

`public.retrieval_contracts` — operator read, admin write, realtime on. Unique on `consumer`. Status enum `declared | implemented | deprecated`. Token budget > 0 check. Source of truth = migrations (never UI).

Registered in `observability_registry` (`surface_kind=table`, 30-day stale watcher) so `observability_stale_surface` fires if declarations stop arriving.

## Typed contract

`supabase/functions/_shared/contracts/retrieval-shape-declaration.ts` mirrors the row as `RetrievalShapeDeclaration` (extends `RetrievalContractMeta`). Exports `CONSUMER_KINDS`, `DECLARATION_STATUSES`, `rowToDeclaration()`, `isComplete()`. Asserted at boot in any edge fn that consumes a retrieval store.

## Initial seed (6 surfaces, 2026-05-25)

| Consumer | Kind | Shape | Store |
|---|---|---|---|
| morning-review | cron | hierarchical-doc | postgres:public.morning_reviews |
| companion-cloud-chat | edge_fn | prose | postgres:public.awip_rag_chunks |
| awip-reviews | cron | prose | github:cjaisingh/verdent-ideas-spark/docs/reviews |
| sentinel-tick | cron | tabular | postgres:public.sentinel_findings |
| night-agent | agent_loop | graph | postgres:public.discussion_actions+discussion_action_findings |
| claims-ingest | edge_fn | relational | postgres:public.claims+claim_events |

Remaining surfaces follow as they ship. Low coverage at start is by design — the missing rows are the work.

## Authoring rule

1. INSERT/UPDATE via a migration. No UI.
2. CHANGELOG entry.
3. New shape or new consumer_kind → update the typed contract file.

## Tests

`supabase/functions/_shared/contracts/retrieval_contracts_test.ts` — declaration registry helpers (rowToDeclaration, isComplete, kind/status constants).

## What this is NOT

- Not enforcement. Surface without a declaration still works.
- Not auto-inferred. Manual on purpose.
- Not a routing layer. Pure metadata.

## See also

- `docs/retrieval-contracts.md`
- `mem://preferences/retrieval-shapes` (the principle)
