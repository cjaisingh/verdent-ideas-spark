---
name: Phase 5/6/6b prep
description: Retrieval contracts + ADR-0003..0006 stubs + source-adapter contract scaffolding for the overnight phase queue
type: feature
---

# Phase 5/6/6b prep

Scaffolding only — no runtime, no schema. Lets the overnight phase runner
(and operator) fill decisions into a fixed shape rather than re-deriving them.

## Retrieval contracts (`supabase/functions/_shared/contracts/`)

One per agent surface, each declares shape + store + token budget per
`mem://preferences/retrieval-shapes`. All four close with
`as const satisfies RetrievalContractMeta` (shared `retrieval-contract.ts`)
and expose a Zod `InputSchema` — the `Input` type is `z.infer<...>` so type
and schema cannot drift. Locked by `retrieval_contracts_test.ts` (18 tests:
sanity ×4, distinct-shape, valid ×4, reject ×9).

- `retrieval-ingest-concierge.ts` — **hierarchical-doc**, 8k budget; lease PDFs, SFG20. Schema requires `sourceRef.rawRecordId` OR `sourceRef.url`, non-empty `query`, `siblingFanout` 0–10.
- `retrieval-validation-agent.ts` — **tabular**, 2k budget; direct SQL over `staged_records`. Schema caps `sampleSize` at 200 (matches documented fallback).
- `retrieval-resolver.ts` — **graph**, 1k budget; deterministic → alias FTS → embedding hint. Schema requires uuid `tenantId`, non-empty `descriptors`, enum-checked `kind`.
- `retrieval-conflict-triage.ts` — **relational**, 4k budget; same-mapping siblings + `conflict_rules`. Schema requires uuid `conflictId`, `siblingWindowDays` 1–365.

## Source-adapter contract

`source-adapter.ts` — locks the auto-promote precondition trio (mapping
approved + validations pass + no PII without basis), idempotency derivation,
hard invariants. Every Phase 6 connector implements this shape.

## ADRs (`docs/adr/`)

- **0003** tenant-node ancestry — **proposed**, lean: denormalised `ancestry_ids[]`; decide at s5.2.
- **0004** alias revocation — **proposed**, lean: hybrid soft+hard; decide at s5.3.
- **0005** bulk conflict patterns — **proposed**, lean: heuristic+LLM hybrid; decide at s6.1.
- **0006** embedding model + index — **ACCEPTED** (2026-05-21): `gemini-embedding-001` @ 1536d + pgvector hnsw (`vector_cosine_ops`, m=16, ef_construction=64). `embedding_model_version` column mandatory. Revisit triggers: embedding spend > €50/mo, sovereignty flip, any store > 1M rows, or Gemini API deprecated.

## Overnight runner expectations

Phase 5/6/6b/7 are queued via `roadmap_phases.run_overnight=true`. Runs
should reference these contracts + ADRs rather than re-deriving shape
decisions; findings drop into the matching ADR's Consequences section.
