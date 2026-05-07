# Plan — phases & sprints committed; s2.6 tasks pending re-scope

_Updated after Migration A landed. Live state on `/roadmap` and `/master-plan`._

## What just landed (Migration A)

- **6 new phases** committed as `planned`: phase-5 (Entity & Tenant Resolution), phase-6 (Ingest & Canonicalisation), phase-6b (Ingest Observability), phase-7 (Connector Marketplace), phase-9 (Multi-tenant Hardening), phase-11 (Public API & SDK). Phase 8 / 10 left as deliberate gaps — reserved for OKR-driven slots once Phase 4 produces signal (noted in phase-7 / phase-9 summaries).
- **Placeholder sprints**: s5.1, s6.1, s6b.1, s7.1, s9.1, s11.1 — one per new phase, each with a single sentinel task `open-questions` (order 0, status `todo`) so pinned notebook questions have a place to land.
- **s2.6 sprint shell** under Phase 2 — title "Loop-task triage + promotion", no tasks yet (held for re-scope).
- **Pinned phase-tagged notebook questions** cross-linked as `system` comments on each phase's `open-questions` sentinel task. Re-running the insert is idempotent (matches on notebook UUID in body).
- **2 stale notebook decisions resolved**: Telegram module shape (phase-2), voice model (phase-4).

## Roadmap state
- Phase 1 done · Phase 2 active (s2.4 hygiene + s2.6 shell pending) · Phases 3, 4 done · Phases 5, 6, 6b, 7, 9, 11 planned.

## Held back — Migration B (s2.6 tasks)

Drafted, not run. Re-scope before committing:

1. `s2.6 t1` — phase-keyword map + `classifyLoopTask()` helper.
2. `s2.6 t2` — promote qualifying loop tasks to `notebook_entries` (`auto-promoted` tag, gated by triage rule).
3. `s2.6 t3` — **schema change**: `ALTER TABLE roadmap_work_log ADD COLUMN task_snapshot jsonb`; serialise loop on every turn.
4. `s2.6 t4` — render "Turn N — task plan" collapsible on roadmap; "Auto-promoted" filter chip + bulk archive on Notebook.

**Open questions before we run B:**
- Keep all 4, or drop t4's roadmap render (Notebook chip alone)?
- `task_snapshot` = full loop (incl. scaffolding) or only promoted subset?

## Outstanding under Phase 2 — s2.4 (mechanical, no decisions)
1. Skip filters on `SkipsPanel`.
2. Link skips back to originating turn.
3. CSV export for skips and `roadmap_work_log`.
4. Linter sweep — `REVOKE EXECUTE … FROM anon, public` on `has_role` and friends.

## Memory updated
`mem://features/automation` documents the operator channel + voice transcription contract.
