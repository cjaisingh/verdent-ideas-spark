# Retrieval contracts (s6.1/t0)

Every consumer surface that reads "knowledge" — prose, tabular rows, graph traversals, time-series, structured relational facts — **must** have a row in `public.retrieval_contracts` declaring which of the 5 shapes it consumes.

This is the "data framework" gate. It exists to stop us picking a vendor (pgvector vs LanceDB vs DuckDB vs Neo4j vs ClickHouse) before we know what each consumer actually needs.

See [`mem://preferences/retrieval-shapes`](../mem/preferences/retrieval-shapes.md) for the underlying principle.

## The 6 shapes

| Shape | Example | Typical store |
|---|---|---|
| `prose` | Chat over reviews / docs | pgvector + hybrid FTS |
| `hierarchical-doc` | Morning review aggregator | Postgres parent/child rows |
| `tabular` | Sentinel findings table | Postgres + indexed columns |
| `graph` | discussion_actions ↔ findings | Postgres junction or Neo4j |
| `relational` | Claims pipeline (W7.2) | Postgres, join-heavy |
| `time-series` | Token-burn / latency p95 | Postgres TSDB or ClickHouse |

## Table

```
public.retrieval_contracts
  consumer            text unique           — surface name, e.g. "morning-review"
  consumer_kind       text                  — edge_fn | cron | ui_route | agent_loop
  shape               text                  — one of the 6 shapes
  store               text                  — concrete URI, e.g. "postgres:public.morning_reviews"
  primary_key         text                  — the natural key in that store
  token_budget        int                   — max tokens per fetch
  freshness_window    text                  — how stale the data is allowed to be
  fallback            text                  — what happens if the store is down
  declared_by         text                  — git ref (e.g. "plan:s6.1/t0")
  status              text                  — declared | implemented | deprecated
  notes               text
```

RLS: operator read, admin write. Realtime: enabled. Registered in `observability_registry` so the existing `observability_stale_surface` watcher catches a 30-day silence (which would mean surfaces are drifting without declarations being updated).

## Authoring rule

To add or change a declaration:

1. INSERT/UPDATE via a migration (never via UI — no UI exists by design).
2. CHANGELOG entry.
3. If a new shape or `consumer_kind` is introduced, update `supabase/functions/_shared/contracts/retrieval-shape-declaration.ts`.

## Initial seed (6 surfaces)

| Consumer | Kind | Shape | Store |
|---|---|---|---|
| morning-review | cron | hierarchical-doc | `postgres:public.morning_reviews` |
| companion-cloud-chat | edge_fn | prose | `postgres:public.awip_rag_chunks` |
| awip-reviews | cron | prose | `github:cjaisingh/verdent-ideas-spark/docs/reviews` |
| sentinel-tick | cron | tabular | `postgres:public.sentinel_findings` |
| night-agent | agent_loop | graph | `postgres:public.discussion_actions+discussion_action_findings` |
| claims-ingest | edge_fn | relational | `postgres:public.claims+claim_events` |

The remaining surfaces follow as they ship. Coverage starts low by design — the missing rows are the work.

## Typed contract

[`supabase/functions/_shared/contracts/retrieval-shape-declaration.ts`](../supabase/functions/_shared/contracts/retrieval-shape-declaration.ts) mirrors the table as a typed `RetrievalShapeDeclaration`, with `rowToDeclaration()` for snake→camel mapping and `isComplete()` as the assert-at-boot helper.

## Tests

- `supabase/functions/_shared/contracts/retrieval_contracts_test.ts` — registry helpers + 4 in-flight contracts (existing).

## What this is **not**

- Not enforcement. A surface without a declaration still works. The point is to make the gap visible before we pick a vendor.
- Not auto-discovered. Surfaces are added by hand because the human-readable shape choice is the whole exercise.
- Not a routing layer. Pure metadata.
