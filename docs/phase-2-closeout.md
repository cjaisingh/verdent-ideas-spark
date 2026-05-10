# Phase 2 closeout — 2026-05-10

Goal: get Phase 2 through the four-gate sign-off so we stop landing Phase 3+ work under a "Phase 2 active" banner.

## Gate snapshot

`select * from public.roadmap_phase_gate_status where phase_key='phase-2'`:

| Gate | Status | Detail |
|---|---|---|
| Structural | ❌ | 7 open tasks (of 16 total) |
| QA | ❌ | 1/3 checks not passing — `Operator can plan/edit/comment/review without leaving /roadmap` is **unknown** (judgement check, never recorded) |
| Night audits | ✅ | 0 high-severity open |
| Approvals | ✅ | 0 pending sign-offs |

## Open Phase 2 tasks (7)

| Sprint | Key | Title | Status | Recommendation |
|---|---|---|---|---|
| Module scaffold + register | `t2` | register endpoint | in_progress | **Ship** — finish the `/capabilities/register` endpoint work. |
| Module scaffold + register | `t3` | approval-callback handler | todo | **Defer** to Phase 3 (Module Scaffold & Capability Maturation). Belongs there per master-plan.md. |
| Operator observability & hygiene | `t1` | Add skip filters to SkipsPanel | todo | **Defer to 2.1** — useful but not blocking sign-off. |
| Operator observability & hygiene | `t2` | Link skips back to originating turn | todo | **Defer to 2.1** — same. |
| Operator observability & hygiene | `t3` | CSV export for skips and work-log | todo | **Defer to 2.1** — operator nice-to-have, not Phase 2 success criterion. |
| Operator observability & hygiene | `t4` | Fix outstanding Supabase security linter warnings | todo | **Ship** — security hygiene; should not roll forward. |
| Operator observability & hygiene | `t5` | Auto-log meta-work against this sprint | in_progress | **Ship** — already in flight; small. |

## QA judgement check

The one un-passed gate is a **judgement** (not a probe). Operator action: open `/roadmap` Phase 2 panel → confirm "Operator can plan/edit/comment/review without leaving /roadmap" → mark pass/fail.

Once marked pass, the QA gate flips green automatically.

## Suggested execution order

1. **Operator** — mark the judgement QA check (5 min on `/roadmap`).
2. **Reclassify `t3 approval-callback handler`** to a Phase 3 sprint (one row update via `roadmap_tasks.sprint_id`).
3. **Create a "Phase 2.1 — observability follow-ups" sprint** under Phase 2 *or* under a new Phase 2 follow-up phase, and move `t1/t2/t3` (Observability sprint) into it. This keeps them visible without blocking Phase 2 sign-off. (Cleaner alternative: leave them in place but mark `wont_do` with a rationale linking to a follow-up issue.)
4. **Ship** `t4` (security warnings) and `t5` (auto-log meta-work).
5. **Ship** `t2` (register endpoint).
6. Operator clicks **Proceed → Request phase sign-off** on `/roadmap`. Gate should flip green; an `approval_queue` row goes in; once approved, `roadmap-phase-signoff` writes `roadmap_phase_signoffs` and flips `phase_status` to `done`.

## ⚠️ Drift between docs and DB phase numbering

While building this report I noticed `roadmap_phases` in the DB does **not** match `docs/master-plan.md`:

| `roadmap_phases.key` | `roadmap_phases.title` | DB status | master-plan.md says |
|---|---|---|---|
| `phase-1` | Core contract | done | Foundations (done) ✅ |
| `phase-2` | operator_channel module | **active** | Operator Channel & Roadmap (active) ✅ |
| `phase-3` | Cutover & cleanup | **done** | Module Scaffold & Capability Maturation (planned) ❌ |
| `phase-4` | **Voice** | **done** | **OKR-Driven Execution (planned)** ❌ |
| `phase-5` | Entity & Tenant Resolution | planned | Entity & Tenant Resolution (planned) ✅ |
| `phase-6` | Ingest & Canonicalisation | planned | Ingest & Canonicalisation (planned) ✅ |
| `phase-6b` | Ingest Observability | planned | Ingest Observability (planned) ✅ |
| `phase-7` | Connector Marketplace | planned | Connector Marketplace (planned) ✅ |
| `phase-9` | Multi-tenant Hardening | planned | Multi-tenant Hardening (planned) ✅ |
| `phase-11` | Public API & SDK | planned | Public API & SDK (planned) ✅ |

**This is the most important finding from the closeout exercise.** The roadmap UI shows phases 3 + 4 as already done, but `docs/master-plan.md` still treats Phase 4 "OKR-Driven Execution" as the architectural centre of gravity.

Implications for the plan:
- **WS-E (Phase 4 kickoff)** as written assumes `phase-4` is empty. It is not — it's titled "Voice" and is closed.
- The OKR-driven execution work needs a **new phase row** (suggest `phase-4b` or a fresh `phase-12 — OKR-Driven Execution`), not a re-use of `phase-4`.
- `docs/master-plan.md` needs a reconciliation pass after Phase 2 closes — either rename/renumber the DB phases to match the doc, or rewrite the doc to match the DB. Recommend the latter (DB is canonical for roadmap state).

I've **paused WS-E** pending operator decision: rename phases vs add a new one. See `WS-E note` below.

## WS-E note (Phase 4 / OKR-driven execution)

Before I run any migrations adding `okr_node_id` to `roadmap_tasks` and a `roadmap_task_outcome_health` view, please confirm:

- (a) **Add a new phase row** (e.g. `phase-okr` / "OKR-Driven Execution") — leaves history intact, fastest. **Recommended.**
- (b) Rewrite `phase-4` from "Voice" to "OKR-Driven Execution" — destructive to history.
- (c) Skip WS-E for now and just close Phase 2.

Reply with **a / b / c** and I'll execute.

## Re-run

```sql
select * from public.roadmap_phase_gate_status where phase_key='phase-2';

select s.title as sprint, t.key, t.title, t.status::text
from public.roadmap_tasks t
join public.roadmap_sprints s on s.id = t.sprint_id
join public.roadmap_phases p on p.id = s.phase_id
where p.key='phase-2' and t.status::text not in ('done','wont_do')
order by s."order", t."order";
```
