# ADR-0003 — OKR-Driven Execution

- Status: Accepted
- Date: 2026-05-10
- Phase: `phase-okr` ("OKR-Driven Execution")

## Context

The substrate records OKRs (`okr_nodes`, `okr_measurements`) and roadmap work (`roadmap_phases`, `roadmap_sprints`, `roadmap_tasks`) as **independent** tables. There is currently no machine-readable link between a task and the outcome it is meant to move. The master plan ([`docs/master-plan.md`](../master-plan.md)) names this gap as Phase 4: *progress should be measured against outcomes, not output*.

The DB's `roadmap_phases.phase-4` was already consumed by the Voice work and is closed. Renaming/rewriting that row would destroy history. We add a **new phase row** (`phase-okr`) instead and treat that as the canonical home for OKR-driven execution.

## Decision

1. Add nullable columns `okr_node_id uuid` and `okr_link_kind text` to `public.roadmap_tasks`.
2. `okr_link_kind` is constrained to `('contributes_to','delivers','measures')` (or `NULL`).
3. Expose a read-only view `public.roadmap_task_outcome_health` joining task → OKR for cheap UI/Sentinel queries (security_invoker so RLS still applies).
4. Linking is **opt-in per task** in this slice. The phase sign-off gate that requires outcome coverage is added in a later slice (sprint `okr-slice-1`, task `t5`) so we can backfill before enforcement.
5. The DB is canonical for phase state. `docs/master-plan.md` is updated to point Phase 4 readers at `phase-okr`.

## Consequences

- `roadmap_tasks` rows can be enriched without breaking existing UI (columns are nullable).
- A future migration will tighten the gate (`outcome_ok` boolean on `roadmap_phase_gate_status`).
- Reporting can now answer "which sprints actually move which key results" via one join.
- The drift between `master-plan.md` and `roadmap_phases` is acknowledged but not retroactively fixed for Phase 3/4 — sufficient context lives in `docs/phase-2-closeout.md`.

## Out of scope

- Renaming/renumbering existing phases.
- Auto-computing task health from `okr_measurements` (separate slice).
- Multi-OKR links per task (single FK for now; revisit if real cases emerge).
