
# Codebase Rationalisation — 7 Lanes

## Goal
Reduce surface area (edge fns, crons, docs, test trees, `any` debt) without losing behaviour. Target: −5 edge fns, −6 cron jobs, −~10 redundant docs, −unfired sentinel checks, single e2e runner, ratchet moving again.

## Non-goals
- No new features. No UI redesign. No schema changes beyond cron consolidation.
- Not touching `awip-api`, Night Agent semantics, or W7 truth resolver.
- Not adopting OpenHuman / local LLM in this plan (separate decision).

## Blast radius & citations
- **Tables:** `cron.job`, `automation_runs`, `sentinel_findings`, `lint_*`. No data tables touched.
- **Edge fns:** delete 3–5 zombies; merge 5 overnight fns into one orchestrator (keep originals as thin re-exports for one release).
- **Surfaces:** `/admin/edge-health`, `/admin/observability-registry`, CI workflows.
- **Core rule cited (`CONTEXT.md`):** "Substrate, not a brain" — dead crons & duplicate docs are accidental brain. **ADR-0002** (service-token/idempotency) — fewer cron callers = fewer token surfaces. **FM-AI failure mode:** *unobserved drift* — unfired sentinel checks give false safety; duplicate docs give stale truth.

## Alternatives considered
1. **Do nothing, write a "tech-debt" memory.** Rejected — debt is already documented (e.g. `edge-function-zombie-triage-2026-05-24.md`) and ignored. Documenting again ≠ fixing.
2. **Big-bang refactor in one PR.** Rejected — blast radius too wide, can't bisect failures.
3. **Lane-by-lane, gated, one PR per lane (chosen).** Each lane independently revertable; ratchet/sentinel give immediate signal.

Two specific micro-alternatives:
- *Overnight crons:* delete vs orchestrator-merge. Chose merge — keeps separation of concerns in code but collapses cron rows + token call sites.
- *e2e trees:* migrate `e2e/` → `e2e-playwright/` vs vice versa. Chose Playwright (already has fixtures + auth + rls map generator).

## Contract (cron/edge-fn/agent)
Only lane needing a new contract is **Lane 2** (overnight orchestrator). Declare `supabase/functions/_shared/contracts/overnight-orchestrator.ts` per `mem://preferences/contract-first`:
- input: `{ phase: 'prequeue'|'runner'|'recommender'|'open'|'close', triggered_at, idempotency_key }`
- output: `{ phase, status, ran_for_ms, child_job }`
- escalation: any phase erroring twice in 24h → sentinel `overnight_orchestrator_red`.
- audit table: existing `automation_runs` (no new table).

## Persona sign-off
- **event-engineer:** every deleted fn must have zero refs in `cron.job`, `src/`, other fns; orchestrator must keep emitting the same `automation_runs` rows under existing `job` names. ✅ Plan keeps job names.
- **compliance-auditor:** W6 branch-protection list (`mem://preferences/ci-cd-hardening`) names workflows by file — none deleted, only test trees consolidated. ✅
- **sentinel:** unfired checks may be true safety nets that never fire because the system is healthy. Plan requires 90-day `sentinel_findings` query + per-check operator decision, not blanket delete. ✅
- **product-historian:** doc dedup must update `README.md` + `CHANGELOG.md` and leave redirects (1-line stub linking new canonical). ✅
- **control-plane-operator:** no routing logic moves; orchestrator is a multiplexer not a router. ✅

## Gap checklist
- [x] Idempotency: orchestrator passes through `Idempotency-Key`; child fns unchanged.
- [x] `*_events` emission: unchanged — no domain mutations in this plan.
- [x] RLS + `has_role`: no new tables; orchestrator uses `AWIP_SERVICE_TOKEN` like siblings.
- [x] Realtime publication: n/a.
- [x] `observability_registry`: must add row for `overnight-orchestrator`; remove rows for deleted fns.
- [x] `withLogger`: orchestrator wrapped; deletions remove their wrapped fns.
- [x] No new `any`: Lane 7 reduces `any`; ratchet enforces.
- [x] Mem rule: update `mem://index.md` Core cron list after Lane 2; add `mem://features/overnight-orchestrator.md`.
- [x] CHANGELOG: one entry per lane.
- [x] Doc updates: per lane below.

## Lanes (sequenced, each = 1 PR)

| # | Lane | Effort | Gate |
|---|---|---|---|
| 1 | Kill zombie edge fns (`automation-auth-monitor`, `copilot-voice`, `roadmap-phase-signoff`, `copilot-noop-llm`, `telegram-send-voice`) after operator confirm | 30m | `rg` shows 0 refs; sentinel green 24h |
| 2 | Overnight orchestrator: merge `night-agent-open/close`, `overnight-phase-runner-15m`, `overnight-prequeue`, `scheduled-overnight-recommender` behind `overnight-orchestrator` with `phase` arg; keep 5 cron rows initially, flip to 1 after green week | 3h | `automation_runs` row counts unchanged per job; one full night cycle clean |
| 3 | Reflection orchestrator: merge `scheduled-lessons-daily/weekly` + `scheduled-deep-audit-weekly/monthly` similarly | 2h | Same |
| 4 | Sentinel check audit: `SELECT check_name, count(*), max(detected_at) FROM sentinel_findings WHERE detected_at > now()-90d GROUP BY 1`; per-check operator decision (keep/delete/demote) | 1h + decisions | Deleted checks have zero findings in 90d AND no safety-net justification |
| 5 | Doc dedup: merge `edge-function-audit.md` + `edge-function-sweep-2026-05-10.md` → `docs/edge-function-inventory.md`; merge 4 phase-5-6 docs → `docs/phase-5-6.md`; leave 1-line redirect stubs | 1h | `bun run check-doc-drift` green |
| 6 | e2e tree consolidation: port remaining `e2e/*.test.ts` into `e2e-playwright/`; delete `e2e/` + `vitest.e2e.config.ts`; update `nightly.yml` | 4h | Playwright suite covers all prior test names; CI green |
| 7 | `any` ratchet sweep: run `codemod-any-enqueue` drafts → batch-apply low-risk ones; lower baseline by ≥50 sites; close discussion_action #20 if zero, else update target | 2h | `bun run lint:ratchet` passes; baseline.total decreases |

## Test plan
- **Lane 1:** `bun run scripts/check-logger-coverage.ts` still 0 failures; `curl_edge_functions` 404 on deleted names; existing e2e suites green.
- **Lane 2/3:** new vitest `supabase/functions/overnight-orchestrator/_test/dispatch.test.ts` — given `{phase:'prequeue'}` calls prequeue handler; given unknown phase returns 400. Live: trigger each phase via `curl_edge_functions` with service token, assert `automation_runs` row written under original `job` name.
- **Lane 4:** SQL query above; document deletion reasons in `docs/sentinel-prune-2026-05-28.md`.
- **Lane 5:** `bun run scripts/check-doc-drift.ts`; manual `rg` for old filenames → only redirect stubs remain.
- **Lane 6:** `bunx playwright test`; diff old vs new test names in PR description.
- **Lane 7:** `bun run lint:ratchet`; CI lint-and-typecheck workflow.

## Validation gates (per lane, all must pass before merge)
```
bun run lint:ratchet
bun run scripts/check-logger-coverage.ts
bun run scripts/check-doc-drift.ts
bunx vitest run
bunx playwright test       # Lane 6+
```
Plus: 24h watch on `sentinel_findings` and `automation_runs` after each merge; rollback if `overnight_orchestrator_red` or `cron_auth_failures_burst` fires.

## Out of scope
- OpenHuman / local LLM swap (separate decision; depends on credit dashboard data).
- Dashboard widget registry refactor (item #4 in earlier scan) — defer until 7th widget actually needed.
- "Feature kit" scaffold generator (item #8) — defer; revisit after Lanes 2+3 prove orchestrator pattern.
- Closing discussion_action #20 if Lane 7 doesn't hit zero — keep as ongoing.
- Branch protection enablement on `main` (operator-only action, tracked in `docs/ci-cd.md`).

Used the rigorous-planning skill.
