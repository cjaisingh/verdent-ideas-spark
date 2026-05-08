# Promotion audit report

For every operator-confirmed Night Agent promotion, the system records a
**before/after report** showing exactly what gates were evaluated, which
candidates were considered, why some were skipped, and which one this
proposal targeted.

## Sources

- **Before** — captured at `/night-agent/open` time and persisted on
  `night_shifts.summary`:
  - `gates` — timezone, window, local time, enabled/in-window/blackout flags, allowed kinds
  - `skip_reasons` — shift-level skip reasons (empty when the shift opened)
  - `candidates_total`, `candidates_selected`, `candidates_skipped` (with reason)
- **After** — assembled live from:
  - `night_proposals.{status, decided_at, decided_by, rationale}`
  - The `audit_complete` row in `night_observations` for the targeted task
  - All other observations recorded for the targeted task

## Endpoint

`GET /awip-api/night-agent/promotion-audit?proposal_id=…` (admin only).
Also accepts `?shift_id=…` to return all reports in a shift.

## UI

- `/admin/promotion-audits` — list view of recent proposals, click to open the report drawer.
- `/night-shifts` — each accepted/rejected proposal row has an "audit" link that opens the same drawer.

## Legacy shifts

Shifts opened before this feature don't have a `gates` snapshot. The report
returns `before.legacy = true` and `before.gates = null`; the UI surfaces a
banner instead of failing.
