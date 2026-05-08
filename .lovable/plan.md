# Phase gates + Proceed action

Two related changes to `/roadmap`:

1. A phase can only show **DONE** when quality gates pass; otherwise the badge warns.
2. A new **Proceed** action sits next to *Next up* and tells the operator (or AI) the single concrete next step for the active phase — and, when the phase is gate-clear, raises a phase sign-off approval.

---

## 1. Phase-done definition (quality-gated)

A phase is **eligible to be DONE** when **all** of:

- **Structural** — every task in every sprint has `status ∈ {done, wont_do}`.
- **QA** — latest `qa_checks` run for any `phase_key` matching the phase has `status='pass'` (or no qa_checks exist for it — treated as `unknown`, which blocks).
- **Night audits clear** — no `night_task_audit` rows with `worst_severity='high'` referencing tasks in the phase that are still unresolved.
- **No open approvals** — no `approval_queue` rows with `status='pending'` whose `intent_payload->>'phase_id'` equals this phase.

A new SQL view `roadmap_phase_gate_status` exposes for each phase:
`phase_id, structural_ok, qa_ok, night_ok, approvals_ok, all_ok, blockers jsonb`.

The current `roadmap_phases.status` stays as the source of truth (operator/sign-off writes it). The view is purely derived — no trigger forces it. This keeps the manual override available and avoids fighting `night-agent` writes.

### Badge behaviour on `/roadmap`

- `status='done'` **and** `all_ok=true` → existing **DONE** badge (green).
- `status='done'` **and** `all_ok=false` → **DONE ⚠** badge (amber) with tooltip listing blockers from `blockers`.
- `status='active'` **and** `all_ok=true` → **READY TO SIGN OFF** chip on the phase row (links to Proceed action — see §2).
- Otherwise → unchanged.

A small `<PhaseGateChip />` component renders blockers inline in the phase detail panel (right pane, top of the phase card).

---

## 2. Proceed button

Replace the current static **NEXT UP** card with a 2-line widget:

```text
┌─────────────────────────┐
│ NEXT UP                 │
│ register endpoint       │
│ ─────────────────────── │
│ ▸ Proceed: start task   │
└─────────────────────────┘
```

The bottom row is the **Proceed** action. Its label and behaviour are **context-aware** based on the active phase + next-up task state:

| Situation | Label | Action |
|---|---|---|
| Next-up task is `todo` | `Start task` | Set task → `in_progress`, start `TurnTracker`, scroll task detail into view |
| Task is `in_progress` and has a pending approval | `Decide approval` | Open the Approval accordion + focus decision controls |
| Task is `in_progress`, no pending approval | `Open log` | Scroll to Work Log accordion + open it |
| Sprint's tasks all done, sprint still `active` | `Close sprint` | Update sprint `status='done'`, log activity |
| Active phase has `all_ok=true` | `Request phase sign-off` | Insert `approval_queue` row (see below) **and** show inline confirm dialog |
| `all_ok=false` and operator clicks | (disabled) | Tooltip lists blockers from the gate view |

The widget shows **one** primary action plus a small secondary `?` that opens a popover explaining *why this is the suggested step* (cites the gate state). This is the "instruct me to proceed" surface.

### Phase sign-off approval

When **Proceed → Request phase sign-off** is clicked:

1. Insert into `approval_queue`:
   - `activity = 'roadmap.phase_signoff'`
   - `risk = 'medium'`
   - `intent_payload = { phase_id, phase_key, gate_snapshot }` (snapshot of `roadmap_phase_gate_status` at click time)
   - `idempotency_key = 'phase-signoff:' || phase_id || ':' || gate_snapshot_hash` so re-clicking is a no-op
2. Show toast: "Sign-off requested for Phase 2 — decide in Approvals" with link to `/admin#approvals`.
3. Existing `ApprovalDecisions` flow handles approve/reject. On approve, a small follow-up edge handler (`roadmap-phase-signoff` — new) flips `roadmap_phases.status='done'` and emits a `capability_events` row `event_type='phase.signed_off'`.

This satisfies "Both" surfaces: inline trigger on the row + audited entry in the approval queue.

---

## Files

**New**
- `supabase/migrations/<ts>_roadmap_phase_gates.sql` — view `roadmap_phase_gate_status`; idempotent.
- `supabase/functions/roadmap-phase-signoff/index.ts` — handles approved sign-off (cron-token or operator JWT).
- `src/components/roadmap/PhaseGateChip.tsx` — blocker list + DONE⚠ badge variant.
- `src/components/roadmap/ProceedAction.tsx` — the context-aware button (consumes gate view + next-up).
- `src/lib/proceed.ts` — pure `decideProceed(state) → { label, action, disabledReason? }` so it's unit-testable.
- `src/lib/proceed.test.ts` — table-driven tests for every row of the table above.

**Edited**
- `src/pages/Roadmap.tsx` — swap static NEXT UP card for `<ProceedAction />`; render `<PhaseGateChip />` on phase rows; consume the new view via a `useRoadmapGates()` hook.
- `src/components/ApprovalDecisions.tsx` — render a small `PhaseGateChip` snapshot when `activity='roadmap.phase_signoff'` so the approver sees what was true at request time.
- `docs/master-plan.md` — short paragraph under "Working agreements": phases require gate-pass + sign-off.
- `CHANGELOG.md`.

## Out of scope

- Auto-flipping phase status without operator click (kept manual on purpose).
- Sprint-level gate (only structural close handled here; quality gates apply at phase level).
- Showing per-task QA badges (could be a follow-up).
- Adding `phase_id` linkage to existing `approval_queue` rows retroactively.

## Validation

- Unit: `proceed.test.ts` covers all 6 table rows.
- Manual on `/roadmap`:
  - Phase 1 currently shows DONE → after deploy renders **DONE ⚠** with blocker "3 open follow-up tasks".
  - Phase 2 (active) shows existing badge + Proceed button reads `Start task` for `register endpoint`.
  - Mark all Phase 2 tasks done in a fixture → Proceed flips to `Request phase sign-off`; clicking creates one row in `approval_queue`; clicking again is a no-op (idempotent).
  - Approving the sign-off in `/admin` sets `roadmap_phases.status='done'` and `capability_events` gains a `phase.signed_off` row.
