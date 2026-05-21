# ADR benchmarks — data-collection checklist

Single source of truth for the data + metrics needed before we close the deferred ADRs (0003, 0004, 0005) and before we re-open the accepted one (0006).

When a trigger event fires, run the matching `scripts/adr-bench/adr-000X-*.ts`, drop the resulting JSON into `bench-results/`, then paste the numbers into the ADR's Consequences section and flip status `proposed → accepted`.

Rule: no opinion-driven decisions on these ADRs. If the data isn't here, the decision waits.

## Readiness gates

| ADR | Decision blocked by | Earliest realistic date |
|---|---|---|
| 0003 ancestry | First imported tenant tree ≥ 5k nodes | sprint s5.2 |
| 0004 revocation cascade | First revocation in anger OR ≥ 50 production aliases bound to facts | sprint s5.3 |
| 0005 bulk conflict detection | First re-ingest dropping ≥ 100 rows into `fact_conflicts` | sprint s6.1 |
| 0006 embedding (accepted) | Live `ai_usage_log` + at least one populated vector store | runnable today |

Operator-facing expectations per phase: see [`docs/phases-overnight-operator-guide.md`](../phases-overnight-operator-guide.md).


## Where the data comes from

| Source | Used by |
|---|---|
| `tenant_nodes` (Phase 5 table, not yet created) | 0003 |
| `canonical_facts` (Phase 6 table) | 0003, 0004 |
| `tenant_node_aliases` + `alias_events` (Phase 5) | 0004 |
| `fact_conflicts` + `conflict_rules` (Phase 6) | 0005 |
| `awip_doc_chunks` (live today) + Phase 6 ingest-concierge fallback store | 0006 |
| `ai_usage_log` (live today) | 0006 |

For tables that don't exist yet, the bench script throws with a pointer back to this doc — no silent stubs.

---

## ADR-0003 — Tenant-node ancestry storage

**Decision question.** Which of `materialised path`, `ltree`, `parent_id + CTE`, or denormalised `ancestry_ids[]` minimises p95 read cost on the RLS-hot subtree-check path without making subtree moves unworkable?

**Trigger event.** First imported tenant tree with ≥ 5k nodes lands in `tenant_nodes`.

**Required dataset.**
- Real `tenant_nodes` import (no synthetic depth padding — the actual shape).
- ~1k synthetic `canonical_facts` rows joined per node (uniform distribution) to exercise the RLS path.
- Same dataset loaded into all four storage variants in throwaway schemas.

**Metrics** (emitted by `scripts/adr-bench/adr-0003-ancestry.ts`):

| Metric | Definition |
|---|---|
| `subtree_query_p50_ms`, `subtree_query_p95_ms` | "Give me every node under X", 200 random Xs. |
| `rls_check_p95_ms` | Single-row "is X in subtree of Y", 5k random pairs. The hot path. |
| `subtree_move_p95_ms` | Move a 100-node subtree to a new parent. |
| `index_bytes`, `column_bytes` | `pg_table_size` / `pg_indexes_size` per variant. |
| `migration_back_out_steps` | Count of operations needed to revert to `parent_id`-only. |

**Decision thresholds.**

| Condition | Decision |
|---|---|
| `rls_check_p95_ms < 3` AND `subtree_move_p95_ms < 500` at 10k nodes | Lean holds — pick `ancestry_ids[]`. |
| `index_bytes` for `ancestry_ids[]` > 3× `parent_id` baseline at 100k nodes | Switch to `ltree`. |
| pgvector extension load order forces no-extension footprint | Switch to materialised path. |
| Any variant fails at 10k nodes | Re-scope dataset before deciding. |

**Owner + when.** Operator runs at sprint s5.2 opening.

**Output.** `bench-results/adr-0003-<timestamp>.json` + a 5-row table pasted into ADR-0003 Consequences.

---

## ADR-0004 — Alias revocation cascade

**Decision question.** Should a revoked alias soft-flag affected facts, hard re-quarantine them, or use a hybrid (soft default + admin "hard revoke")?

**Trigger event.** First revocation in anger OR 50 production-shaped aliases bound to facts, whichever first.

**Required dataset.**
- Real `tenant_node_aliases` + their bound `canonical_facts`.
- 30 days of `alias_events` for affected-row counts and operator dwell time.

**Metrics** (emitted by `scripts/adr-bench/adr-0004-revocation.ts`):

| Metric | Definition |
|---|---|
| `affected_facts_p95` | Per revocation, count of facts the revoke would touch. |
| `kr_rollups_grey_seconds_p95` | Time KR dashboards would stay grey under option 2 (estimated from rollup recompute time × affected KRs). |
| `stale_badge_dwell_p95_days` | Under option 1: how long a stale binding sits before operator clears it. |
| `compliance_revocation_count_30d` | How often "hard revoke" gets used in the trailing 30d. |

**Decision thresholds.**

| Condition | Decision |
|---|---|
| `compliance_revocation_count_30d ≥ 1` AND `affected_facts_p95 < 200` | Lean holds — pick hybrid. |
| `compliance_revocation_count_30d == 0` over 90d | Drop the hard path — pick pure soft. |
| `stale_badge_dwell_p95_days > 14` | Operators ignore soft badges — pick pure hard re-quarantine. |
| `affected_facts_p95 > 1000` | Block both — design partial-revoke API first. |

**Owner + when.** Operator runs at sprint s5.3 opening.

**Output.** `bench-results/adr-0004-<timestamp>.json` + a 4-row table pasted into ADR-0004 Consequences.

---

## ADR-0005 — Bulk conflict pattern detection

**Decision question.** For a 100+ row `fact_conflicts` pile, does heuristic group-by, LLM-suggested pattern, or hybrid (heuristic → LLM on the tail) minimise operator time per resolved row at acceptable cost?

**Trigger event.** First re-ingest that drops ≥ 100 rows into `fact_conflicts`.

**Required dataset.**
- That real conflict pile (full row dump).
- 30 days of historical `fact_conflicts` resolutions for ground-truth labelling of "which conflicts shared a real cause".

**Metrics** (emitted by `scripts/adr-bench/adr-0005-bulk-conflicts.ts`):

| Metric | Definition |
|---|---|
| `heuristic_coverage_pct` | Share of conflicts grouped by `(source_mapping_id, fact_type, value_pair_hash)`. |
| `llm_residual_coverage_pct` | Share of the ungrouped tail the LLM successfully patterns (≥ N siblings under one rule). |
| `llm_tokens_per_conflict_resolved` | p50 + p95 from `ai_usage_log` rows tagged with the bench run id. |
| `false_positive_rate` | Operator rejections of proposed `conflict_rules` rows over the bench window. |
| `time_to_clear_pile_minutes_p95` | End-to-end operator time per 100-row pile. |

**Decision thresholds.**

| Condition | Decision |
|---|---|
| `heuristic_coverage_pct ≥ 70%` AND `llm_residual_coverage_pct ≥ 50%` AND `llm_tokens_per_conflict_resolved.p95 < 5000` | Lean holds — pick hybrid. |
| `heuristic_coverage_pct ≥ 90%` consistently | Drop LLM — pick heuristic-only. |
| `heuristic_coverage_pct < 40%` | Patterns are mostly semantic — pick LLM-only. |
| `false_positive_rate > 10%` | Block auto-proposal — proposed `conflict_rules` rows require operator approval before insert. |

**Owner + when.** Operator runs at sprint s6.1 opening, against the first real pile.

**Output.** `bench-results/adr-0005-<timestamp>.json` + a 5-row table pasted into ADR-0005 Consequences.

---

## ADR-0006 — Embedding model + index (revisit instrumentation)

**Decision question.** Are any of the four revisit triggers tripping in live data?

**Trigger event.** Continuous — run weekly once Phase 6 ingest-concierge ships. Runnable today against `ai_usage_log`; vector-store metrics are structurally `0` until any `public.*` table grows an `embedding` column.

**Required dataset.** Live `ai_usage_log` (embedding-tagged rows) + every table carrying an `embedding` column.

**Metrics** (emitted by `scripts/adr-bench/adr-0006-embedding.ts`):

| Metric | Definition |
|---|---|
| `embedding_spend_usd_30d` | Sum of `ai_usage_log.cost_usd` where `job` ~ `'%embed%'` over trailing 30d. ADR intent is €50/mo; metric is USD because that's what the column stores. |
| `vector_row_count_max` | Max `count(*)` across tables with an `embedding` column. Structurally `0` pre-Phase-6. |
| `hnsw_query_p95_ms` | Per store, sampled from the bench's own 200-query loop. Structurally `0` when no vector tables exist. |
| `re_embed_jobs_30d` | Count of `ai_usage_log` rows tagged `job='re-embed'`. |

**Revisit triggers** (locked in the ADR; this just locks the measurement):

| Condition | Action |
|---|---|
| `embedding_spend_usd_30d > 50` | Re-open ADR-0006. |
| `vector_row_count_max > 1_000_000` | Re-open ADR-0006. |
| Gemini embedding API deprecation announced | Re-open ADR-0006 (manual signal). |
| Sovereignty posture flips to "must self-host embeddings" | Re-open ADR-0006 (manual signal). |

**Owner + when.** Sentinel-eligible once Phase 6 ships; until then, operator runs ad hoc.

**Output.** `bench-results/adr-0006-<timestamp>.json`.

---

## Conventions

- All bench results land in `bench-results/` (gitignored).
- Every result JSON carries `{ adr, ran_at, dataset_hash, metrics }` — `dataset_hash` is a sha256 of the input row IDs so two runs over the same data are byte-comparable.
- Bench scripts never mutate production tables. 0003 works in throwaway schemas; 0004/0005/0006 are read-only.
- A bench result alone does not flip an ADR — paste the numbers into the ADR's Consequences section, set `status: accepted`, add a CHANGELOG `### Decided` bullet, then update `mem/features/phase-5-6-prep.md`.
