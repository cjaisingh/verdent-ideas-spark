
# R1 Truth-up — Execution Plan

Operationalises `docs/roadmap-2026-h2.md` R1 against the corpus merged in batches 1–3. Sequenced so each slice is independently reviewable and revertible; no slice depends on a later one's success. Total estimate: **~4.5–6 dev-days** across ~10 calendar days, gated on ADR-0004 bench runtime and two operator-clicked sign-offs.

## Goal
Make the master plan, the DB, the drift CI, and the frozen ADRs agree with the roadmap-2026-h2 v2 release plan; unblock W10 S3 by declaring tenant-zero; correct the batch-1 CHANGELOG line.

## Non-goals
- No R2+ work (no second adapter, no FM1 endpoints, no Control Plane extraction).
- No new W10 stage work beyond creating S1/S2 tracking rows.
- No lint fixes beyond scaffolding the codemod task (execution is a separate slice below, but ratchet target ≤400 stays R1's numeric gate — not a rewrite pass).

## Blast radius & Core rule cited
- **Files:** `docs/master-plan.md`, `docs/constellation.md`, `CHANGELOG.md`, `scripts/check-doc-drift.ts`, `.github/workflows/doc-drift.yml`, `docs/adr/0004-*.md`.
- **DB:** `roadmap_phases` (inserts for R1–R6 + w10-s1…s6, updates to legacy phase rows), `roadmap_tasks` (S1.1–S6.4 + W10 stage-1/2 tasks + sidecar + codemod), `discussion_actions` (tenant-zero, sidecar host, codemod, phase sign-offs), `roadmap_phase_signoffs` (via Proceed flow, operator-clicked).
- **Core rule (CONTEXT.md):** every mutation emits its event — phase inserts must fire the existing `roadmap_phases` triggers; sign-offs go through `roadmap.phase_signoff` approval, not a direct status flip (per `docs/master-plan.md` working agreements).
- **ADR:** ADR-0004 (revocation) is the only ADR touched.

---

## Slices

### Slice 1 — Master plan rewrite + YAML frontmatter (~0.5 day)
Rewrite `docs/master-plan.md`'s phase list with R1–R6 from `roadmap-2026-h2.md`. Add YAML frontmatter:
```yaml
---
phases:
  - {key: r1-truthup, status: active}
  - {key: r2-ingest-depth, status: planned}
  - {key: r3-fm1, status: planned}
  - {key: r4-tenant-hardening, status: planned}
  - {key: r5-control-plane, status: planned}
  - {key: r6-marketplace, status: planned}
  - {key: phase-4, status: done, note: "Voice — closed, DB row reused"}
  - {key: phase-okr, status: reserved, note: "acceptance folded into R3"}
  - {key: w7, status: frozen, note: "W7.3/W7.4 triggers live in R3"}
---
```
Legacy phases 1–3, 5, 6, 6b get annotated with their R-release disposition (per the reconciliation table). Reserved slots (phase-8, phase-10) get a one-line "superseded by R-series" note.
**Risk:** frontmatter keys must exactly match the `roadmap_phases.key` column we'll seed in Slice 3 — misalignment silently breaks Slice 2's CI check. Mitigation: write Slice 3 seed SQL and Slice 1 frontmatter side-by-side, diff before merging.

### Slice 2 — Drift guard extension (~0.75 day)
Extend `scripts/check-doc-drift.ts` with two new rules:
- **Rule 4 (phase parity):** parse master-plan frontmatter, query `roadmap_phases` via a small read-only helper (needs `SUPABASE_URL` + anon key in CI env — already present per `.github/workflows/doc-drift.yml`), fail on any `key` present in one and not the other, or on `status` mismatch.
- **Rule 5 (constellation ↔ capabilities):** parse `docs/constellation.md` §3 module table, query `capabilities` grouped by `owning_module` for aggregate status, fail on mismatch.
Both rules skippable via existing `doc-drift-ok` label. Add to `GITHUB_STEP_SUMMARY` output.
**Risk (flagged):** rule 5's "aggregate status" is not defined in the corpus — constellation §3 uses one status per module, but a module has N capabilities at various maturity levels. **Ambiguity — needs decision before build:** does "module status = max(capability status)", "= min", or "= manually declared field"? Suggest adding a `docs/constellation.md` §3 legend row and, if needed, a `modules.declared_status` column. Recommend deferring rule 5 to a follow-up if the decision drags.

### Slice 3 — DB operationalisation (~1 day, 2 migrations)
- **Migration A:** insert `roadmap_phases` rows for `r1-truthup`…`r6-marketplace` and `w10-s1`…`w10-s6`; update legacy rows (`phase-2`, `phase-5`) to `awaiting_signoff` status; annotate `phase-4`/`phase-okr` in `notes`.
- **Migration B:** insert `roadmap_tasks` rows for platform spec requirement IDs S1.1–S6.4 (from `docs/prd-spec-h2-2026.md §9`) linked to their R-release phase; insert W10 S1+S2 task rows (from `docs/specs/w10-corporate-ingestion/plan.md`) linked to `w10-s1`/`w10-s2`; insert sidecar-host and codemod tasks (Slice 8).
Every insert respects the four-gate model (tasks start `planned`, no gate flips). Verification: `SELECT key, status FROM roadmap_phases WHERE key LIKE 'r%' OR key LIKE 'w10-%'` matches the frontmatter list from Slice 1.
**Risk:** row count is ~30 phase entries and ~40–60 task entries — one bad `phase_id` FK sinks the migration. Mitigation: run in a single transaction, seed via a values-list not per-INSERT statements.

### Slice 4 — ADR-0004 revocation bench (~0.5 day, mostly runtime)
Run `bun run scripts/adr-bench/adr-0004-revocation.ts --write-decision` against the current corpus (1,100 aliases satisfies the gate per `scripts/adr-bench/_shared.ts` threshold). Inspect the emitted decision JSON; if the bench recommends flipping the ADR's status, edit `docs/adr/0004-*.md` to reflect the new decision + evidence; otherwise amend the ADR with the confirming datapoint. Commit both the `adr_bench_results` row (via bench's own insert) and the ADR edit.
**Risk:** bench may exceed the AI-call budget if it re-embeds the corpus. Confirm before running that embeddings are cached (`resolver_decisions` already carries them per Phase 5 shipped state).

### Slice 5 — Phase 2 & Phase 5 sign-off (~0.25 day operator time, blocking)
For each of `phase-2` and `phase-5`: click **Proceed → Request phase sign-off** on `/roadmap`, which raises the `roadmap.phase_signoff` approval. Verify all four gates in `roadmap_phase_gate_status` read green beforehand. Approve.
**Risk (flagged):** this is operator-clicked, not agent-executable. Plan slot exists only to remind + verify gate state; the actual click is a manual step. If any gate is red, the plan spawns a sub-task rather than force-flipping status.

### Slice 6 — Tenant-zero declaration (~0.25 day)
Insert one `discussion_actions` row (via `insert` tool, not migration):
- `title`: "Declare tenant-zero (consultancy's own estate) as W10 pilot tenant"
- `body`: cites `docs/readiness-companion.md §1` + `docs/specs/w10-corporate-ingestion/roadmap.md` S3 entry gate; states an external pilot may upgrade later
- `owner`: (needs operator input — flagged below)
- `due_date`: end of R2 window (per roadmap)
- `source`: `plan_footer`, `source_ref`: `plan:r1-truthup#tenant-zero`
- links to the `w10-s3` phase row from Slice 3
**Ambiguity:** owner field — assume operator; confirm in build mode.

### Slice 7 — Housekeeping (~0.25 day)
- `CHANGELOG.md`: remove "platform PRD/spec" from the batch-1/3 line (it landed in batch 2/3); collapse the stray double blank line after that entry.
- `docs/constellation.md §4`: append the maintenance rule "The repo text of the merged strategic corpus is canonical over any chat-era originals."
**Risk:** none.

### Slice 8 — Setup tasks (~0.25 day)
Two `roadmap_tasks` rows (created in Slice 3's Migration B, but described here for clarity):
- **Sidecar host decision** — links `docs/adr/0011-*.md §hosting`; description notes monthly cost estimate must be entered as a recurring `credit_entries` line per `docs/readiness-companion.md §7`; due end of R1.
- **Codemod: `codemod_replace_any` top-10 files** — links `.lint-baselines/no-explicit-any.json`; acceptance = baseline ≤400 after run; due end of R1.
**Risk:** codemod may cascade type errors past the ratchet gate. Mitigation: dry-run first, land per-file PRs.

---

## Sequencing & dependencies
```text
Slice 1 ─┬─> Slice 2 (needs frontmatter keys)
         └─> Slice 3 (must match frontmatter keys)
Slice 3 ─┬─> Slice 6 (needs w10-s3 row)
         └─> Slice 8 (task rows piggyback on Migration B)
Slice 4  (independent, long runtime — start in parallel with Slice 1)
Slice 5  (blocks on nothing new; needs current gates green)
Slice 7  (independent, trivial — bundle with any slice)
```
Recommended run order: **4 (in background) + 1 → 3 → 2 → 6/7/8 → 5 (operator)**.

## Flagged risks & ambiguities (need answers before build)
1. **Slice 2 rule 5:** how is "module status" defined? (max/min/declared)
2. **Slice 6:** owner for the tenant-zero action — you, or a named delegate?
3. **Slice 4:** confirm bench embedding cache before run to avoid budget spike.
4. **Slice 5:** confirm both phases' four gates are currently green — if not, this slice grows.
5. **Slice 3:** confirm the R-release keys (`r1-truthup` etc.) are the naming you want in the DB — once seeded, they're referenced by frontmatter, CI, and every downstream task.

## Effort summary
| Slice | Est | Blocks |
|---|---|---|
| 1 Master plan | 0.5d | 2, 3 |
| 2 Drift CI | 0.75d | — |
| 3 DB seed | 1d | 6, 8 |
| 4 ADR-0004 bench | 0.5d (runtime) | — |
| 5 Sign-offs | 0.25d operator | — |
| 6 Tenant-zero | 0.25d | unblocks W10 S3 |
| 7 Housekeeping | 0.25d | — |
| 8 Setup tasks | 0.25d | — |
| **Total** | **~3.75d agent + 0.25d operator** | |

## Out of scope
Rule 5 implementation if the module-status definition question doesn't resolve this week; any codemod actually running (task-only in R1); R2 adapter work; any doc rewrites beyond the master-plan phase list; a Control Plane extraction spike.
