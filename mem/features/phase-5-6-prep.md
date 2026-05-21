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
`mem://preferences/retrieval-shapes`.

- `retrieval-ingest-concierge.ts` — **hierarchical-doc**, 8k budget; lease PDFs, SFG20.
- `retrieval-validation-agent.ts` — **tabular**, 2k budget; direct SQL over `staged_records`.
- `retrieval-resolver.ts` — **graph**, 1k budget; deterministic → alias FTS → embedding hint.
- `retrieval-conflict-triage.ts` — **relational**, 4k budget; same-mapping siblings + `conflict_rules`.

## Source-adapter contract

`source-adapter.ts` — locks the auto-promote precondition trio (mapping
approved + validations pass + no PII without basis), idempotency derivation,
hard invariants. Every Phase 6 connector implements this shape.

## ADR stubs (`docs/adr/`)

All **proposed**; decision deferred to the sprint that exercises them.

- **0003** tenant-node ancestry — lean: denormalised `ancestry_ids[]`; decide at s5.2.
- **0004** alias revocation — lean: hybrid soft+hard; decide at s5.3.
- **0005** bulk conflict patterns — lean: heuristic+LLM hybrid; decide at s6.1.
- **0006** embedding model + index — lean: `gemini-embedding-001` @ 1536d + hnsw; decide at s6.2.

## Overnight runner expectations

Phase 5/6/6b/7 are queued via `roadmap_phases.run_overnight=true`. Runs
should reference these contracts + ADRs rather than re-deriving shape
decisions; findings drop into the matching ADR's Consequences section.
