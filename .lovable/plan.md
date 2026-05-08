## Goal

Give admins one screen that answers "for each capability, can it be promoted to Phase-3 maturity (`status='available'`), and if not, exactly what is blocking it and which operator action unblocks it?" — plus a one-click promote/ack flow that records the decision.

Phase 3 in `docs/master-plan.md` = "Module Scaffold & Capability Maturation". A capability is **Phase-3 ready** when its registry entry is complete, its connectors are wired, its dependencies resolve, demand exists, and no open blocking signals remain.

## What blocks promotion (gate definitions)

Each gate evaluates to `pass | warn | fail` per capability. Promotion requires zero `fail` gates; `warn` requires admin ack.

| Gate | Source | Fail when | Operator action |
|------|--------|-----------|-----------------|
| `manifest_complete` | `capabilities` row | `name`, `description`, `owning_module`, or `version` empty; `version='0.1.0'` (still scaffold) | Edit manifest in source module's `capabilities.json` and re-register |
| `inputs_outputs_declared` | `capabilities.inputs_required`, `outputs_provided` | either array empty | Update scaffold; redeploy register fn |
| `connectors_wired` | `capability_connectors` count | 0 rows AND `inputs_required` references an external `kind` | Add row in `capability_connectors` |
| `dependencies_resolved` | latest `capability_events` where `event_type='resolution_warning'` for this `capability_id` | any unresolved warning newer than last `registered` event | Investigate event payload; re-register or fix dep |
| `demand_present` | `okr_measurements.required_capabilities` containing this id | no row references it | Either tie an OKR measurement to it or mark capability `deprecated` |
| `qa_phase_3_passing` | `qa_checks` where `phase_key='phase-3'` | any row with `status` in (`fail`,`unknown`) | Run probe / set judgement on `/master-plan` qa panel |
| `no_open_approvals` | `approval_queue` filtered by `capability_id` | any row `status='pending'` | Decide pending approval |
| `not_already_available` | `capabilities.status` | already `available` or `deprecated` | n/a (gate hides promote button) |

The set lives in one pure module so it can be reused by an edge endpoint and unit-tested.

## Surfaces

### 1. New page `src/pages/CapabilityPromotion.tsx` — route `/admin/capability-promotion`

Admin-only (mirror `NightAgentTestModeCard` pattern: check `has_role(_role: 'admin')`, render a polite "admin required" stub otherwise). Sidebar entry under Admin section.

Layout:
- **Summary header** — counts: `ready` / `blocked-fixable` / `blocked-needs-fail` / `already-available`.
- **Filter row** — status (planned/experimental), owning module, "show only blocked", search.
- **Capability table** — one row per capability with columns: id+name, status badge, gate-summary chips (pass/warn/fail counts), most-severe blocking reason (one line), and an actions cell.
- **Row expand** — full gate list with per-gate verdict, the failure reason text, and the "operator action" hint (from the gate definition table above). Inline links: gate `connectors_wired` deep-links to `/capabilities/:id`; `qa_phase_3_passing` to `/master-plan#phase-3`; `no_open_approvals` to `/approvals/:id` for each pending row.
- **Actions cell** —
  - `Promote to available` (enabled only when zero fails + zero un-acked warns)
  - `Acknowledge warnings` (admin-only, opens a small modal capturing a free-text rationale)
  - `Refresh` (re-runs the evaluation)

### 2. Backend endpoint `awip-api`: `GET /capabilities/promotion-status`

New handler in the existing `awip-api` edge function (keep with the rest of the contract surface — Core memory rule says single edge function for the contract):

- Returns `{ capability, gates: [{ key, verdict, reason, action_hint }], summary }[]`.
- Admin-only (operator JWT + `has_role admin`); accepts no body.
- Single capability variant: `GET /capabilities/:id/promotion-status` for the row-expand call.
- Pure gate logic lives in a sibling module `supabase/functions/awip-api/promotion_gates.ts` so it can be reused by a Deno test.

Sister endpoint:

- `POST /capabilities/:id/promote` — admin-only; re-evaluates gates server-side (never trust client), refuses if any fail or un-acked warn, then updates `capabilities.status='available'` and inserts a `capability_events` row `event_type='promoted_to_available'` with `payload={gates, ack_rationale, actor}`. Idempotent via `Idempotency-Key`.
- `POST /capabilities/:id/ack-warnings` — admin-only; inserts `capability_events` `event_type='warnings_acknowledged'` with `payload={gate_keys, rationale}`. Subsequent gate evaluations treat those warns as acked when an `ack` event newer than the warning exists.

### 3. Capability detail page — small banner

On `/capabilities/:id`, add a compact "Promotion status" strip (visible to all operators, not just admins) showing the top blocking reason and a link to the admin page. No new fetch — reuse the single-capability endpoint.

## Data model — no schema changes needed

All gate state derives from existing tables. `capability_events` already accepts arbitrary `event_type` values, so `promoted_to_available` and `warnings_acknowledged` slot in without migrations. RLS already restricts `capabilities` writes (admin-only via the `awip-api` service role path).

## Files

New:
- `src/pages/CapabilityPromotion.tsx` — page shell + admin gate
- `src/components/promotion/PromotionTable.tsx` — table + row expand
- `src/components/promotion/PromotionGateRow.tsx` — single-gate display + action hint
- `src/components/promotion/PromoteDialog.tsx` — confirm + rationale capture
- `src/components/promotion/PromotionBadge.tsx` — used on `/capabilities/:id` banner
- `src/lib/promotion-gates-types.ts` — shared TS types (mirror of edge return)
- `supabase/functions/awip-api/promotion_gates.ts` — pure gate evaluator
- `supabase/functions/awip-api/promotion_gates_test.ts` — Deno tests
- `docs/capability-promotion.md` — gate definitions + operator runbook

Edited:
- `supabase/functions/awip-api/index.ts` — three new routes
- `src/App.tsx` — add `/admin/capability-promotion` route
- `src/components/OperatorLayout.tsx` (or wherever the sidebar lives) — admin-only nav entry
- `src/pages/CapabilityDetail.tsx` — embed `<PromotionBadge>`
- `README.md` + `CHANGELOG.md` — short entry

## Verification

1. `supabase--test_edge_functions awip-api` — gate evaluator unit tests cover each gate's pass/warn/fail.
2. Seed one capability that fails each gate; confirm UI shows correct chip + action hint.
3. Promote a fully-passing capability; confirm `capabilities.status` flips and a `capability_events` row appears.
4. Try promoting a failing capability via curl with an admin JWT — must 409.
5. Try same call with an operator-but-not-admin JWT — must 403.

## Non-goals

- No automated promotion (admin click only).
- No new tables; gate state is derived.
- No changes to `night-agent`, roadmap, or copilot.
- No Phase-3 *project-wide* declaration — purely per-capability.

## Risks

- **Resolution warning noise** — `capability_events` already has 159 `resolution_warning` rows. The gate uses "newer than last `registered`" as the cutoff so historical warnings don't block forever.
- **`demand_present` is harsh for utility capabilities.** Mitigation: this gate emits `warn`, not `fail`; admin can ack with rationale.
- **Idempotency.** Promote/ack endpoints reuse the existing `Idempotency-Key` pattern from other awip-api writes.
