# Overnight phases — operator guide

What the overnight runner will actually do tonight for Phase 5, 6, 6b, and 7, and what to look at in the morning.

Core is substrate, not a brain. Overnight runs operate **inside the contracts** in [`supabase/functions/_shared/contracts/`](../supabase/functions/_shared/contracts/) and **against the ADRs** in [`docs/adr/`](./adr/). If a behaviour isn't listed under "What tonight's run does", it didn't happen — file a `discussion_action` instead of assuming the runner improvised.

**See also:**
- [`docs/phases-5-6-6b-research.md`](./phases-5-6-6b-research.md) — the invariants and open questions feeding these phases.
- [`docs/adr/benchmarks.md`](./adr/benchmarks.md) — the data we need before each ADR stub flips from `proposed` to `accepted`.
- [`docs/overnight-recommender.md`](./overnight-recommender.md) — what gets queued and when.

## How to read each phase section

| Field | What it tells you |
|---|---|
| **Governed by** | The contracts and ADRs in force. If the contract changes, this guide must change in the same PR. |
| **What tonight's run does** | The concrete steps the night agent / phase runner is allowed to take. |
| **Won't do** | Hard guard rails — observed deviations are bugs, not "the agent decided otherwise". |
| **Morning checks** | Exact UI surfaces and tables to inspect first. |
| **What unblocks the next sprint** | The trigger event from `docs/adr/benchmarks.md` that closes an ADR stub. |

All overnight runs use `google/gemini-2.5-flash-lite` (22:00–06:00 UTC model policy). TTS bypasses this.

---

## Phase 5 — Entity & Tenant Resolution

**Governed by**
- Contract: [`retrieval-resolver.ts`](../supabase/functions/_shared/contracts/retrieval-resolver.ts) — graph shape, 1k token budget, match order **deterministic → alias FTS → embedding-hint**.
- ADR-0003 (ancestry storage) — *proposed*, lean: denormalised `ancestry_ids[]` on facts. Decides at s5.2.
- ADR-0004 (alias revocation cascade) — *proposed*, lean: hybrid (soft flag default + admin hard-revoke). Decides at s5.3.

**What tonight's run does**
- Resolves descriptors against `tenant_nodes` + `tenant_node_aliases` in the contract-fixed order. Authoritative IDs (BIM IFC GUID, RICS, OS UPRN, SAP FLOC) short-circuit fuzzy match.
- Confident match → records the alias and binds the fact.
- Ambiguous → emits an `entity_resolution_conflicts` row for operator review.
- No match → proposes a new node, with parent placement, for operator approval.
- One approval binds the whole batch (one decision per source file).

**Won't do**
- Cross tenant boundaries. Every query carries `tenant_id`.
- Promote facts with a guessed `tenant_node_id` — proposals only.
- Auto-commit a fuzzy alias. Aliases are explicit + operator-approved.
- Pick a final ancestry storage strategy (ADR-0003 still *proposed*).
- Auto-merge or auto-split `tenant_nodes` — both are first-class approval kinds.

**Morning checks**
- `/admin/jobs` filtered to `night-agent` — runs from the 22:00–06:00 window.
- Morning Review → "Phase progress" panel for the Phase 5 row.
- `entity_resolution_conflicts` count delta and any new proposal rows.

**What unblocks the next sprint**
- First imported tenant tree ≥ 5k nodes → run `scripts/adr-bench/adr-0003-ancestry.ts` → close ADR-0003 at s5.2.
- First revocation in anger OR ≥ 50 production aliases bound to facts → run `scripts/adr-bench/adr-0004-revocation.ts` → close ADR-0004 at s5.3.

---

## Phase 6 — Ingest & Canonicalisation

**Governed by**
- Contract: [`retrieval-ingest-concierge.ts`](../supabase/functions/_shared/contracts/retrieval-ingest-concierge.ts) — hierarchical-doc shape, 8k token budget, embedding fallback via ADR-0006.
- Contract: [`source-adapter.ts`](../supabase/functions/_shared/contracts/source-adapter.ts) — auto-promote requires the trio: mapping approved + validations pass + no PII without lawful basis. Idempotency-Key is derived per the contract, not invented.
- ADR-0005 (bulk conflict pattern detection) — *proposed*, lean: hybrid heuristic + LLM-on-the-tail. Decides at s6.1.
- ADR-0006 (embedding model + index) — **accepted (2026-05-21)**: `google/gemini-embedding-001` @ 1536 dims + pgvector `hnsw` (`vector_cosine_ops`, m=16, ef_construction=64). `embedding_model_version` column mandatory on every embedding-bearing table.

**What tonight's run does**
- For sources with all three preconditions satisfied: derives the Idempotency-Key, runs the ingest, writes `canonical_facts`, logs to `ai_usage_log`.
- For sources missing any precondition: stops, surfaces the missing element on the Morning Review ingest panel.
- For prose corpora (leases, SFG20, internal docs): chunks per ADR-0006 strategy (clause / task / message / utterance), embeds via Gemini @ 1536, indexes with hnsw.
- For bulk conflict piles: groups by `(source_mapping_id, fact_type, value_pair_hash)`; proposes — never inserts — `conflict_rules` rows.

**Won't do**
- Silently overwrite an existing fact. The "no silent overwrite" invariant holds at every layer.
- Embed canonical facts — they are tabular and queried via SQL.
- Run hybrid vector + FTS search (explicitly deferred in ADR-0006).
- Auto-resolve a conflict without proposing a `conflict_rules` row.
- Re-embed across model versions silently — any swap must bump `embedding_model_version` and be tracked per row.

**Morning checks**
- `/admin/jobs` rows for `overnight-phase-runner` Phase 6 invocations.
- `fact_conflicts` count delta over the night window.
- `bench-results/adr-0006-*.json` — confirms `embedding_spend_eur_30d` and `vector_row_count_max` haven't crossed a revisit trigger.
- `ai_usage_log` filtered to embedding jobs for the night window.

**What unblocks the next sprint**
- First re-ingest dropping ≥ 100 rows into `fact_conflicts` → run `scripts/adr-bench/adr-0005-bulk-conflicts.ts` → close ADR-0005 at s6.1.
- ADR-0006 is closed; the bench is now revisit-monitoring only.

---

## Phase 6b — Ingest Observability

**Governed by**
- Contract: [`retrieval-validation-agent.ts`](../supabase/functions/_shared/contracts/retrieval-validation-agent.ts) — tabular shape, 2k token budget, hard `sampleSize ≤ 200` cap enforced by Zod.

**What tonight's run does**
- Samples up to 200 rows from each ingest run for distribution / null-rate / value-range checks.
- Emits validation findings against the run, surfaced on the Morning Review validation panel.
- Times each step into `automation_steps` so per-phase p95s land in `v_automation_step_p95_30d`.

**Won't do**
- Bypass the 200-row sample cap (the contract rejects > 200 at parse time).
- Mutate the rows it's sampling — read-only.
- Decide whether an ingest is valid — surfaces findings, operator calls it.

**Morning checks**
- Morning Review → validation-agent panel.
- `v_automation_step_p95_30d` for Phase 6b step timings.
- Sentinel findings tagged `validation_*`.

**What unblocks the next sprint**
- No ADR stub gates 6b. Sprint advances on operator sign-off of the validation panel coverage.

---

## Phase 7 — Truth & Governance

**Governed by**
- Contract: [`retrieval-conflict-triage.ts`](../supabase/functions/_shared/contracts/retrieval-conflict-triage.ts) — relational shape, 4k token budget.
- `decision_authorities` (W7.1) + `claims` (W7.2) — `resolve_truth(entity, entity_id, field)` is the only sanctioned arbitration path; rules are git-versioned via migrations + CHANGELOG.
- `governance_links` (W7.1.5) — manual joins task ↔ notebook ↔ entity ↔ authority rule (relations: touches / justifies / governs / supersedes).

**What tonight's run does**
- Pulls `truth_conflicts_unresolved` and proposes (not commits) discussion_actions for ties that have sat unresolved past threshold.
- Surfaces uncovered tasks (no entity / notebook / authority-rule link) on `/governance` via the existing `governance_uncovered_tasks` RPC.

**Won't do**
- Edit `decision_authorities` rules. Those are git-versioned — no editing UI, no overnight mutation.
- Infer governance links. `governance_links` are manual by design; coverage starts at 0% to make holes visible.
- Auto-resolve a `truth_conflicts_unresolved` row. The resolver picks the winner; ties stay open for operator arbitration.
- Promote a claim past `confidence` it didn't earn — `resolve_truth` precedence then weight × confidence is the contract.

**Morning checks**
- `/governance` coverage card — should reflect any new manual links added overnight (none expected from the agent itself).
- `truth_conflicts_unresolved` sentinel finding count.
- Open discussion_actions tagged Phase 7.

**What unblocks the next sprint**
- W7.2 claims pipeline already shipped. Phase 7 closes on coverage thresholds being met manually on `/governance` — no ADR stub gating it.

---

## When this guide is wrong

If a contract in `supabase/functions/_shared/contracts/` or an ADR in `docs/adr/` changes, **update this file in the same PR**. The contract is the law; this guide is the operator-facing reading of the law. They must agree.

Drift is a `discussion_action` (medium risk) — open one against the contract/ADR that changed, citing the section of this guide that needs the update.
