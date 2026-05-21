## Skill: `rigorous-planning`

Create a new workspace skill that forces every non-trivial plan through the same hardening pass: deep thinking → double-check → gap analysis → test plan → validation → fix loop. Tailored to AWIP Core conventions (contracts, personas, ADRs, doc-drift, session lifecycle).

### Why this shape

Planning is a procedural workflow with a fixed sequence and several fragile invariants (contract-first, RLS, events emission, doc/CHANGELOG/mem updates). A workflow skill with checklists + reference files is the right fit. Heavy lifting goes into references so the SKILL.md stays scannable.

### Files to create

```
.agents/skills/rigorous-planning/
├── SKILL.md
└── references/
    ├── deep-think.md       # framing, assumption surfacing, alternatives
    ├── double-check.md     # persona consultation map, challenge prompts
    ├── gap-analysis.md     # what's missing: tests, docs, events, RLS, idempotency, mem
    ├── test-plan.md        # how to derive vitest/playwright/e2e/bench coverage
    └── validation.md       # verify-completion gates, doc-drift, RLS verify, bench
```

### SKILL.md shape

- **Frontmatter description** triggers on: "plan", "approach", "how should we build", "kickoff", "sprint plan", "design", "before we build", and any request mentioning "double check / deep think / validate".
- **When to use**: any plan touching ≥2 files, a migration, an edge fn, an agent loop, or a phase/sprint.
- **Workflow (7 steps)**:
  1. **Frame** — restate goal, non-goals, blast radius. Cite the Core rule + ADR + FM-AI failure mode the work defuses (`docs/why-awip.md`).
  2. **Deep-think** — load `references/deep-think.md`. Generate ≥2 alternatives, pick one with reasoning, list discarded options + why. Compose with `grill-me` skill.
  3. **Contract-first check** — if adding cron/edge-fn/agent loop, declare typed contract in `supabase/functions/_shared/contracts/` before code. Reference `docs/agents/contract-checklist.md`.
  4. **Persona double-check** — load `references/double-check.md`. Run plan past the relevant persona(s) from `docs/agents/team/` (okr-strategist, event-engineer, tenant-manager, compliance-auditor, sentinel, product-historian). Capture each persona's objections inline.
  5. **Gap analysis** — load `references/gap-analysis.md`. Walk the checklist: idempotency key, `*_events` emission, RLS + `has_role`, realtime publication, observability_registry entry, `withLogger`, no new `any`, mem rule, CHANGELOG bullet, doc updates.
  6. **Test plan** — load `references/test-plan.md`. Each new behaviour gets: unit (vitest), edge-fn (Deno test or `curl_edge_functions`), e2e (`e2e/*.test.ts`), and — for ADR-touching work — a bench script under `scripts/adr-bench/`. Compose with `tdd` skill.
  7. **Validation & fix loop** — load `references/validation.md`. Run `bun run lint:ratchet`, `bun run rls:verify`, `scripts/check-doc-drift.ts`, `scripts/check-logger-coverage.ts`, relevant tests, and `supabase--read_query` + `curl_edge_functions` against live. Every failure → fix → re-run. Don't claim done until all green per `mem://preferences/verify-completion`.
- **Output format**: the plan must include sections `Goal`, `Non-goals`, `Alternatives considered`, `Persona sign-off`, `Gap checklist`, `Test plan`, `Validation gates`, `Out of scope` (footer — feeds `plan-footer-ingest` per `awip-session-lifecycle` skill).
- **Composes with**: `grill-me`, `tdd`, `diagnose`, `awip-core-rules`, `awip-session-lifecycle`, `contract-first` (mem preference).
- **Invariants** (reserved absolutes): MUST cite Core rule defused; MUST list ≥2 alternatives; MUST include test plan before "ready to build"; MUST end with explicit validation gates and an Out-of-scope footer.

### Reference files (one-screen each)

- **deep-think.md** — prompts: "what is the failure mode I'm not seeing?", "what would the product-historian reject?", "what breaks at 100× scale?", "what's the cheapest way to be wrong?". Forces alternatives table.
- **double-check.md** — persona→trigger map (e.g. "touches RLS → tenant-manager + compliance-auditor"; "new event → event-engineer"; "OKR shape → okr-strategist"; "cron/agent → sentinel + contract-first").
- **gap-analysis.md** — single checklist mirroring AGENTS.md "Definition of done" plus contract/observability items.
- **test-plan.md** — decision tree: pure logic→vitest; DB→pgTAP-style read_query assertion; edge-fn→Deno + curl; UI→playwright; ADR→bench script + row in `adr_bench_results`.
- **validation.md** — exact commands + success criteria for each gate; what to do on failure (fix in place, don't defer to "out of scope" unless truly out of scope).

### Hand-off

After writing the four files, call `skills--apply_draft` with `.agents/skills/rigorous-planning` to activate.

### Out of scope

- Editing existing skills (`awip-session-lifecycle`, `contract-first`) — only reference them.
- Building any UI or DB for "plan quality metrics" — skill is instructional only.
- Auto-enforcement (lint/CI). Could be a follow-up workstream; not part of this skill.