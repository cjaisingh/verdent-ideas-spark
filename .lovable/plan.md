## Goal

Give the operator a one-stop, plain-language guide that answers — for each of Phase 5, 6, 6b, 7 — *"what will the overnight runner actually do tonight, what should I see in the morning, and which contract/ADR is governing the behaviour?"*

Existing `docs/phases-5-6-6b-research.md` is research-flavoured (locked invariants + open questions) and doesn't cover Phase 7. The overnight recommender doc explains scheduling but says nothing about per-phase expected outcomes. This adds the missing layer.

Doc-only. No code, no schema, no runtime change.

## Deliverable

### 1. New file `docs/phases-overnight-operator-guide.md` (~250 lines)

Structure:

**Top of file**
- One-paragraph framing: "Core is substrate, not a brain. Overnight runs operate inside the contracts in `supabase/functions/_shared/contracts/` and against the ADRs in `docs/adr/`. If a behaviour isn't listed here, it didn't happen — file it as a discussion_action."
- "How to read this guide" mini-key: **Governed by**, **What the run does**, **Won't do**, **Morning checks**, **What unblocks the next sprint**.
- Pointer back to `phases-5-6-6b-research.md` for invariants + open questions and to `docs/adr/benchmarks.md` for the data that closes ADR stubs.

**Per-phase section** (Phase 5, 6, 6b, 7 — same fixed shape):

1. **Governed by** — bullet list naming the contracts (`retrieval-*.ts`, `source-adapter.ts`) and ADRs (0003–0006) in play, with one-line "lean direction" reminder for stub ADRs.
2. **What tonight's run does** — concrete steps the night agent / phase runner will perform inside the fixed shape (e.g. for Phase 5: "resolves descriptors against `tenant_nodes` in deterministic → alias-FTS → embedding-hint order per `retrieval-resolver` contract; proposes new nodes when no match; never auto-binds without operator approval").
3. **Won't do** — the non-negotiables, framed as guard rails not failures. Pulled directly from invariants already in `phases-5-6-6b-research.md` (e.g. "won't promote facts with guessed `tenant_node_id`", "won't embed canonical facts", "won't pick a final ancestry storage — ADR-0003 still proposed").
4. **Morning checks** — exact UI surfaces to inspect (Morning Review panel name, /admin/jobs for the run, `bench-results/` for any ADR bench output, sentinel findings with the matching `__check_key`).
5. **What unblocks the next sprint** — the trigger event from `docs/adr/benchmarks.md` (e.g. for Phase 5: "first imported tenant tree ≥ 5k nodes unblocks ADR-0003 decision at s5.2").

**Phase-specific content** (drafted from existing artefacts — no new claims):

- **Phase 5 — Entity & Tenant Resolution.** Governed by `retrieval-resolver.ts` (graph, 1k, deterministic→alias FTS→embedding-hint), ADR-0003 (ancestry, lean: `ancestry_ids[]`), ADR-0004 (revocation cascade, lean: hybrid). Won't: cross tenant boundaries, auto-commit fuzzy aliases, choose ancestry storage. Morning checks: /admin/jobs filter `night-agent`, Morning Review "Phase progress" panel.

- **Phase 6 — Ingest & Canonicalisation.** Governed by `retrieval-ingest-concierge.ts` (hierarchical-doc, 8k, embedding fallback per ADR-0006), `source-adapter.ts` auto-promote trio (mapping approved + validations pass + no PII without lawful basis + idempotency-derived key), ADR-0005 (bulk conflicts, lean: hybrid heuristic+LLM), ADR-0006 (**accepted** — `gemini-embedding-001@1536` + hnsw). Won't: silently overwrite, embed canonical facts, run hybrid vector+FTS, auto-resolve conflicts without proposing a `conflict_rules` row. Morning checks: ingest run rows, `fact_conflicts` count delta, `bench-results/adr-0006-*.json`.

- **Phase 6b — Ingest Observability.** Governed by `retrieval-validation-agent.ts` (tabular, 2k, `sampleSize ≤ 200`). Won't: bypass the sample cap, mutate the source rows it's sampling. Morning checks: validation-agent panel + `automation_steps` view for per-phase timing.

- **Phase 7 — Truth & Governance.** Governed by `retrieval-conflict-triage.ts` (relational, 4k), existing `decision_authorities` + `claims` (W7.1/W7.2), `governance_links` (W7.1.5). Won't: edit authority rules outside git, infer governance links, auto-resolve `truth_conflicts_unresolved`. Morning checks: /governance coverage, `truth_conflicts_unresolved` sentinel.

**Footer**
- "When this guide is wrong" — instruction to update this file in the same PR as any contract/ADR change, mirrored in `mem://preferences/docs`.

### 2. Cross-links — three 1-line edits

- `docs/phases-5-6-6b-research.md` — top-of-file pointer: "Operator-facing overnight expectations: see `docs/phases-overnight-operator-guide.md`."
- `docs/overnight-recommender.md` — top-of-file pointer to the same.
- `docs/adr/benchmarks.md` — under "Readiness gates" add: "Operator-facing expectations per phase: see `docs/phases-overnight-operator-guide.md`."

### 3. README + CHANGELOG + memory

- `README.md` — add the new guide under the docs index where the other phase docs live.
- `CHANGELOG.md` — one `### Added` bullet under `[Unreleased]`.
- `mem/features/phase-5-6-prep.md` — append a one-line link under the existing "Overnight runner expectations" section.

## Out of scope

- No code, no migrations, no edge functions, no UI.
- No re-statement of invariants already in `phases-5-6-6b-research.md` beyond what's needed for the "Won't do" list.
- No new operator workflow — only documents what already happens.
- Not touching ADR text (already back-pointed via the benchmarks plan).
- Not touching `mem://features/automation` or any sentinel doc.

## Verification

- `bun run lint:ratchet` and `bun run typecheck` unaffected (markdown only).
- `scripts/check-doc-drift.ts` runs clean (new file referenced from README + CHANGELOG).
- Manual read-through: every "Governed by" entry matches an actual file in `supabase/functions/_shared/contracts/` or `docs/adr/`.

## Size

- 1 new doc (~250 lines).
- 3 one-line cross-links.
- README + CHANGELOG + memory bullet.

~6 files touched, zero runtime change.
