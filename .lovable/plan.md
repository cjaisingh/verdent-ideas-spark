## Goal

When the first real tenant tree, alias revocations, and conflict pile land, we should be running a pre-agreed benchmark — not improvising one. This plan writes a single source-of-truth checklist (`docs/adr/benchmarks.md`) plus thin runnable stubs that lock the metric shape now, so the deferred decisions (0003 ancestry, 0004 cascade, 0005 bulk conflicts) and the revisit triggers for the already-accepted 0006 are settled by data, not opinion.

Doc-first, no schema, no edge functions, no migrations.

## Deliverables

### 1. `docs/adr/benchmarks.md` — single new file

Sections in this exact order; one per ADR plus a top-level "Readiness gates" and "Where the data comes from" section.

For every ADR section:

- **Decision question** (one sentence, copied from the ADR's Context).
- **Trigger event** (what data has to land before the benchmark is meaningful).
- **Required dataset** (rows / shape / minimum size) — see per-ADR below.
- **Metrics to collect** — fixed list per ADR; same metric names as the runnable stub emits.
- **Decision thresholds** — concrete numbers, not adjectives. Lean wins if all "lean threshold" rows pass; switch to alternate if any "switch threshold" row trips.
- **Owner + when** — which sprint/operator runs it.
- **Output** — path of the JSON dump from the bench stub + the line to add to the ADR's Consequences section.

#### Per-ADR specifics

**ADR-0003 (ancestry storage)** — trigger: first imported tenant tree ≥ 5k nodes.

Dataset: real `tenant_nodes` import + 1k synthetic `canonical_facts` rows joined per node.

Metrics (all measured against the same dataset, four times — once per option):
- `subtree_query_p50_ms`, `subtree_query_p95_ms` — "give me every node under X".
- `rls_check_p95_ms` — single-row `is X in subtree of Y` (the RLS-hot path).
- `subtree_move_p95_ms` — move a 100-node subtree.
- `index_bytes`, `column_bytes` — on-disk cost (`pg_table_size`).
- `migration_back_out_steps` — count of irreversible-without-rebuild operations.

Decision thresholds:
- **Lean (`ancestry_ids[]`) holds** if `rls_check_p95_ms < 3ms` AND `subtree_move_p95_ms < 500ms` at 10k nodes.
- **Switch to `ltree`** if `index_bytes` for `ancestry_ids[]` > 3× the parent_id baseline at 100k nodes.
- **Switch to materialised path** only if pgvector extension load order forces a no-extension footprint.

**ADR-0004 (alias revocation cascade)** — trigger: first revocation in anger OR 50 production-shaped aliases bound to facts (whichever first).

Dataset: real alias table + the actual fact set bound to those aliases. Stop guessing the blast radius.

Metrics:
- `affected_facts_p95` per revocation in last 30d.
- `kr_rollups_grey_seconds_p95` (option 2 only) — how long dashboards go grey.
- `stale_badge_dwell_p95_days` (option 1) — how long a stale binding sits before operator clears it.
- `compliance_revocation_count_30d` — how often "hard revoke" gets used.

Decision thresholds:
- **Lean (hybrid) holds** if `compliance_revocation_count_30d ≥ 1` AND `affected_facts_p95 < 200` (i.e. soft flag stays usable for the common case).
- **Switch to pure soft** if `compliance_revocation_count_30d == 0` over 90 days.
- **Switch to pure hard re-quarantine** if `stale_badge_dwell_p95_days > 14` (operators ignore soft badges → forcing function needed).

**ADR-0005 (bulk conflict pattern detection)** — trigger: first re-ingest that drops ≥ 100 rows into `fact_conflicts`.

Dataset: that real conflict pile + 30 days of historical conflicts for ground-truth labelling.

Metrics:
- `heuristic_coverage_pct` — share of conflicts grouped by `(source_mapping_id, fact_type, value_pair_hash)`.
- `llm_residual_coverage_pct` — share of the *ungrouped tail* the LLM successfully patterns.
- `llm_tokens_per_conflict_resolved` — cost of LLM patterning at p50/p95.
- `false_positive_rate` — operator rejects of proposed `conflict_rules` rows.
- `time_to_clear_pile_minutes_p95` — end-to-end operator time per 100-row pile.

Decision thresholds:
- **Lean (hybrid) holds** if `heuristic_coverage_pct ≥ 70%` AND `llm_residual_coverage_pct ≥ 50%` at `llm_tokens_per_conflict_resolved.p95 < 5k`.
- **Switch to heuristic-only** if `heuristic_coverage_pct ≥ 90%` consistently — LLM stops earning its tokens.
- **Switch to LLM-only** if `heuristic_coverage_pct < 40%` — patterns are mostly semantic.

**ADR-0006 (embedding model + index)** — *accepted*, but the four revisit triggers need live instrumentation, not vibes.

Dataset: live `awip_doc_chunks` + Phase 6 ingest-concierge store once it lands.

Metrics (rolling 30d):
- `embedding_spend_eur_30d` — sum from `ai_usage_log` filtered on embedding kinds.
- `vector_row_count_max` — max `count(*)` across embedding tables.
- `hnsw_query_p95_ms` per store.
- `re_embed_jobs_30d` — count of `embedding_model_version` mismatches detected.

Revisit-trigger thresholds (already in the ADR; this just locks how we measure them):
- Re-open if `embedding_spend_eur_30d > 50`.
- Re-open if `vector_row_count_max > 1_000_000`.
- Re-open if Gemini embedding API hits Google's deprecation list (manual signal, no metric).
- Re-open if sovereignty posture flips (manual signal).

### 2. `scripts/adr-bench/` — four thin TS stubs

One file per ADR. Each:
- Imports `bun`'s test/perf helpers + a shared `writeBenchResult()` from `scripts/adr-bench/_shared.ts`.
- Defines the input contract (`InputSchema` with Zod) — what dataset path / Postgres URL the runner must supply.
- Defines the output contract — `{ adr: string; ran_at: string; dataset_hash: string; metrics: Record<string, number> }` written to `bench-results/<adr>-<timestamp>.json`.
- Body is `throw new Error("not yet runnable — see docs/adr/benchmarks.md § ADR-XXXX for dataset prereqs")`.

Files:
- `scripts/adr-bench/_shared.ts` — `writeBenchResult()`, dataset-hash helper, JSON shape.
- `scripts/adr-bench/adr-0003-ancestry.ts`
- `scripts/adr-bench/adr-0004-revocation.ts`
- `scripts/adr-bench/adr-0005-bulk-conflicts.ts`
- `scripts/adr-bench/adr-0006-embedding.ts` (this one will be runnable today — it queries `ai_usage_log` + counts existing `awip_doc_chunks`; the others throw until their tables exist).

The four files are referenced by name from the benchmarks doc so "what do we run?" has a single answer.

### 3. ADR back-pointers — four 1-line edits

Append to each ADR's "Decision" section (or "Revisit trigger" for 0006):

> Benchmark + dataset requirements: see [`docs/adr/benchmarks.md § ADR-000X`](./benchmarks.md#adr-000x).

That's it for the ADRs — no other content changes.

### 4. Docs + memory

- `CHANGELOG.md` — one `### Added` bullet under `[Unreleased]`.
- `mem/features/phase-5-6-prep.md` — append a "Benchmarks" section listing the four bench scripts + the doc path.

## Out of scope

- No new database tables (Phase 5/6 hasn't created the underlying tables yet — premature to add columns).
- No instrumentation wired into edge functions today.
- No changes to retrieval contracts, source-adapter contract, or `retrieval-contract.ts`.
- No changes to existing tests.
- No dashboard UI for bench results.
- Not deciding any of the deferred ADRs in this pass — only locking *how* we'll decide.

## Verification

- Bench stubs compile under `bun run lint:ratchet` and `bun run typecheck` (they're TS, no `any`).
- `adr-0006-embedding.ts` runs end-to-end today against the live DB and writes a real result file (proves the harness wiring works).
- `scripts/check-doc-drift.ts` passes (every benchmarks.md ADR section header matches an existing ADR filename).

## Size

- 1 new doc (~350 lines).
- 5 new TS files (~30–80 lines each).
- 4 one-line ADR edits.
- CHANGELOG + memory bullet.

~10 files touched, zero runtime change to the platform.
