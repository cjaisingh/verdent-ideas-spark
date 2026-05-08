# Capability Phase-3 promotion

Admin-only workflow that decides when a capability can be moved from
`planned`/`experimental` to `available` (the Phase-3 maturity bar in
`docs/master-plan.md`). Surfaces blocking reasons and the operator
action that unblocks each.

## Where

- **Page:** `/admin/capability-promotion` (sidebar → System → Capability promotion)
- **Banner:** strip on `/capabilities/:id` for any operator
- **API:** `awip-api` edge function

## Gates (all admin-only)

| Key | Verdict on fail | Source | Operator action |
|---|---|---|---|
| `manifest_complete` | fail (or warn for `0.1.0` scaffold version) | `capabilities` row | Edit module's `capabilities.json` and re-register |
| `inputs_outputs_declared` | fail | `capabilities.inputs_required`/`outputs_provided` | Declare inputs/outputs in scaffold |
| `connectors_wired` | fail when external `kind` inputs declared with no `capability_connectors` row | `capability_connectors` count | Add a row in `capability_connectors` |
| `dependencies_resolved` | warn while a `resolution_warning` event newer than last `registered` is un-acked | `capability_events` | Investigate event payload, then ack |
| `demand_present` | warn (never blocks) | `okr_measurements.required_capabilities` | Tie an OKR measurement, or ack |
| `qa_phase_3_passing` | fail when any `phase-3` row in `qa_checks` is not `pass` | `qa_checks` | Run probe / set judgement on Master Plan |
| `no_open_approvals` | fail when any pending row in `approval_queue` references the capability | `approval_queue` | Decide pending approvals |
| `not_already_available` | fail when status already `available`/`deprecated` | `capabilities.status` | n/a |

Promotion requires zero `fail`. `warn`s require an `ack_rationale` (recorded as a `warnings_acknowledged` event) before promotion.

## API

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/awip-api/capabilities/promotion-status` | — | All capabilities + summary |
| GET | `/awip-api/capabilities/:id/promotion-status` | — | Single capability |
| POST | `/awip-api/capabilities/:id/promote` | `{ ack_rationale?: string }` | Re-evaluates server-side; 409 if any fail or unacked warn. Idempotent via `Idempotency-Key`. Inserts `capability_events.event_type='promoted_to_available'` |
| POST | `/awip-api/capabilities/:id/ack-warnings` | `{ rationale: string, gate_keys: string[] }` | Inserts `capability_events.event_type='warnings_acknowledged'` |

All four require an admin operator JWT. The pure evaluator lives in
`supabase/functions/awip-api/promotion_gates.ts` and is covered by
`promotion_gates_test.ts` (run via `supabase test_edge_functions`).

## Operator runbook

1. Open `/admin/capability-promotion`.
2. Use **Show only blocked** to focus on capabilities needing attention.
3. Expand a row to read each gate's reason and action hint. Follow the
   linked surface (capabilities detail, master plan, approvals) to fix.
4. If only `warn` gates remain, click **Acknowledge warnings**, supply a
   one-line rationale, then **Promote to available**.
5. The promotion shows up immediately on `/events` and on the
   capability's detail page.
