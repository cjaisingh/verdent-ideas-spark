# ADR-0005: Bulk conflict pattern detection algorithm

- **Status:** proposed
- **Date:** 2026-05-21

## Context

A messy re-ingest can drop 400+ rows into `fact_conflicts` in one batch, almost all of which share a structural cause ("the supplier renamed column `kWh_total` to `total_kwh`"). Surfacing them as 400 individual cards is unworkable; auto-resolving silently violates the "no silent overwrite" invariant.

Three detection strategies:

1. **Heuristic group-by** — group conflicts by `(source_mapping_id, fact_type, value_pair_hash)`. Deterministic, cheap, no LLM. Misses semantic patterns ("all values off by a unit conversion").
2. **LLM-suggested pattern** — feed `ConflictTriageRetrievalOutput` siblings to Gemini 2.5 Flash, ask for a single rule that covers ≥N siblings. Catches semantic patterns; costs tokens; non-deterministic.
3. **Hybrid** — heuristic groups by default; LLM only runs on the residual ungrouped tail and only when sibling count > threshold.

## Decision

**TBD** — decide when sprint `s6.1` opens and we have a real conflict pile to test against.

Current lean: option 3 (hybrid). Heuristic handles the bulk of mechanical drift; LLM earns its token cost on the long tail.

## Consequences

To be filled in once the decision lands. Any algorithm we ship must propose a `conflict_rules` row rather than mutating facts directly — the "never silent overwrite" invariant holds at every layer.
