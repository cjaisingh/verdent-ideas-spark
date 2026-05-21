## Goal

Prep work so tonight's overnight queue (phase-5/6/6b/7) lands on something concrete instead of re-deriving open questions. Everything here is docs + typed contract stubs — no schema changes, no edge functions, no UI.

## Scope

Three foundations that block real implementation:
1. Retrieval contracts (mandated by `mem://preferences/retrieval-shapes`).
2. ADR stubs (called out in `docs/phases-5-6-6b-research.md § ADRs to draft this round`).
3. Source-adapter input contract (mandated by `mem://preferences/contract-first` for any new ingest agent loop).

## Deliverables

### 1. Retrieval contracts — `supabase/functions/_shared/contracts/`

One file per agent surface that reads memory in Phase 5/6/6b. Each declares: data shape (prose / hierarchical-doc / tabular / graph / time-series), store, return schema, token budget, freshness window. Following the `night-agent.ts` reference shape.

- `retrieval-ingest-concierge.ts` — hierarchical-doc shape for lease PDFs and SFG20; PageIndex-style section retrieval; budget 8k.
- `retrieval-validation-agent.ts` — tabular shape; direct table query against `staged_records`; no embeddings; budget 2k.
- `retrieval-resolver.ts` — graph shape over `tenant_nodes` + `tenant_node_aliases`; deterministic descriptors first, alias FTS second, embeddings only as a last-resort hint; budget 1k.
- `retrieval-conflict-triage.ts` — relational over `fact_conflicts` + `conflict_rules`; recent-N + same-mapping siblings; budget 4k.

Each file: TypeScript module exporting `Input` / `Output` Zod schemas and a `RetrievalContract` const literal so the overnight runner can spot-check shape coverage.

### 2. ADR stubs — `docs/adr/`

Four new files following `docs/adr/_template.md`. Status `proposed`, options enumerated, recommendation marked TBD with the trigger ("decide when sprint s5.2 opens" etc.). No commitments — these are scaffolds so overnight runs and operator review have a single place to drop findings.

- `0003-tenant-node-ancestry-storage.md` — path vs ltree vs CTE vs denormalised `ancestry_ids[]`.
- `0004-alias-revocation-cascade.md` — soft flag vs hard re-quarantine; admin-only approval.
- `0005-bulk-conflict-pattern-detection.md` — heuristic groupby vs LLM-suggested pattern.
- `0006-embedding-model-and-index.md` — Gemini `text-embedding-004` vs OpenAI `text-embedding-3-small` vs BGE self-host; hnsw vs ivfflat at expected corpus size; per-source chunk strategy table.

### 3. Source-adapter input contract — `supabase/functions/_shared/contracts/source-adapter.ts`

Typed I/O the Phase 6 `s6.2` sprint will implement against. Captures: `raw_record` envelope, `source_mapping_ref`, declared `pii_fields[]`, `lawful_basis`, idempotency key derivation, and the auto-promote precondition trio (mapping approved + validations pass + no PII without basis). No runtime — pure types + Zod.

### 4. CHANGELOG + memory hookup

- `CHANGELOG.md` `[Unreleased]` — one bullet under **Added** linking the retrieval contracts + ADR stubs + source-adapter contract; explicit "no runtime change" note so doc-drift doesn't trip.
- `mem://features/phase-5-6-prep.md` — 30-line index entry covering: which contracts exist, which ADRs are stubbed, where decisions still need to land, the overnight-runner expectations. Link from `mem://index.md` under **Memories**.

## Out of scope

- Any database migration (no `entity_resolution_conflicts`, no `raw_records`, no `canonical_facts`).
- Any edge function or cron change.
- ADR *decisions* — only stubs this round; final answers land per-sprint.
- Caprica vision branch (still deferred).
- Phase 7 connector marketplace contract — Phase 7 is queued overnight but the contract surface depends on Phase 6's source-adapter shape; pulled into the next round.

## Verification

- `bun run lint` clean on the new TS files.
- `scripts/check-doc-drift.ts` clean for the new commit (CHANGELOG bullet covers all four ADRs + memory file).
- `scripts/check-okr-links.ts` not affected (no roadmap mutations).

## Estimated size

~9 new files, ~1 CHANGELOG edit, ~1 mem/index.md edit. No migrations. Land in one commit.
