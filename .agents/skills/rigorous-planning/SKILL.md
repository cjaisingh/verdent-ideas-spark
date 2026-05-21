---
name: rigorous-planning
description: Use before writing or approving any non-trivial plan on AWIP Core — sprints, phases, migrations, edge functions, agent loops, multi-file refactors. Triggers on "plan", "kickoff", "approach", "how should we build", "design", "double check", "deep think", "validate". Forces a 7-step hardening pass (frame → deep-think → contract-first → persona double-check → gap analysis → test plan → validation & fix loop) so plans ship green the first time.
---

# Rigorous planning

A plan that skips deep-think, persona challenge, gap analysis, test plan, or validation gates produces work that breaks in CI, in `sentinel_findings`, or at the operator review. This skill prevents that.

## When to use

- Any plan touching ≥2 files, a migration, an edge function, a cron, an agent loop, an ADR, or a phase/sprint kickoff.
- Any user request mentioning "plan", "design", "kickoff", "deep think", "double check", "validate", or "make sure it's right".

Skip for: one-line copy edits, single-file UI tweaks, pure Q&A.

## Workflow

Run the seven steps in order. Each step's output goes into the final plan under the matching section. Don't compress — every section earns its place or the plan is not ready.

### 1. Frame
- Restate goal in one sentence, plus 2–3 **non-goals** (what this is explicitly NOT doing).
- Name the **blast radius**: which tables, edge fns, crons, surfaces, tenants.
- Cite the **Core rule** (`CONTEXT.md`), **ADR**, and **FM-AI failure mode** (`docs/why-awip.md`) the work defuses. If you can't cite one, the work probably doesn't belong in Core.

### 2. Deep-think
Load `references/deep-think.md`. Generate **≥2 alternatives**, pick one with reasoning, list discarded options + why. Compose with the `grill-me` skill if available.

### 3. Contract-first check
If the plan adds a cron, edge function, or agent loop: declare the typed input contract in `supabase/functions/_shared/contracts/<name>.ts` **before** any handler code. Reference `docs/agents/contract-checklist.md` and `mem://preferences/contract-first`.

### 4. Persona double-check
Load `references/double-check.md`. For each persona triggered by the blast radius, write one bullet capturing what they would object to and how the plan answers it. Personas live in `docs/agents/team/`.

### 5. Gap analysis
Load `references/gap-analysis.md`. Walk the checklist (idempotency, `*_events` emission, RLS + `has_role`, realtime publication, `observability_registry`, `withLogger`, no new `any`, mem rule, CHANGELOG, doc updates). Every unchecked box is either fixed in the plan or moved to "Out of scope" with justification.

### 6. Test plan
Load `references/test-plan.md`. Every new behaviour gets named test coverage: vitest (unit), Deno or `curl_edge_functions` (edge fn), `e2e/*.test.ts` (integration), bench script under `scripts/adr-bench/` (ADR-touching). Compose with `tdd` skill — failing test first.

### 7. Validation & fix loop
Load `references/validation.md`. List the exact commands that will be run after build and their pass criteria. Every failure → fix in place → re-run. Don't claim done until all gates green per `mem://preferences/verify-completion`. Compose with `diagnose` skill on stubborn failures.

## Required output format

The final plan MUST include these sections, in this order:

```
Goal
Non-goals
Blast radius & Core rule / ADR / FM-AI cited
Alternatives considered
Contract (if cron/edge-fn/agent)
Persona sign-off
Gap checklist
Test plan
Validation gates
Out of scope        ← footer, feeds plan-footer-ingest per awip-session-lifecycle
```

## Invariants

- MUST cite at least one Core rule, ADR, or FM-AI failure mode the change defuses.
- MUST list ≥2 alternatives with reasoning for the chosen one.
- MUST include a named test for every new behaviour before "ready to build".
- MUST end with explicit validation gates + commands and an Out-of-scope footer.

## Composes with

- `awip-session-lifecycle` — Out-of-scope footer goes to `plan-footer-ingest`; deferred mid-flight items go to `session-summary-log`.
- `grill-me`, `tdd`, `diagnose` (from `mattpocock/skills`).
- `awip-core-rules`, `awip-module-register` (`docs/agents/`).
- Persona skills under `docs/agents/team/`.

## References

- `references/deep-think.md`
- `references/double-check.md`
- `references/gap-analysis.md`
- `references/test-plan.md`
- `references/validation.md`
