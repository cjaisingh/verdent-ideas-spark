## Goal

For every operator-confirmed Night Agent run (each accepted `night_proposal`), produce a structured **promotion audit report** that shows the exact gate snapshot at open time, the skip-reason list, and the selected candidates — and pairs it with the after-state (what the operator actually accepted/rejected and the per-job audit_complete result).

This makes "why did this thing get promoted last night?" a one-click answer, and creates an immutable trail for post-hoc review.

## Scope

In:
- Persist the full gate snapshot when `/night-agent/open` runs.
- Read endpoint that returns a before/after report per proposal or per shift.
- Admin UI page that lists confirmed promotions with drill-down to the diff.

Out (non-goals):
- No changes to Capability Promotion (`/capabilities/:id/promote`) — different flow.
- No changes to gate logic, eligibility rules, or the 5-step audit.
- No new tables — reuse `night_shifts.summary` (jsonb) + `night_proposals.payload`.

## Approach

### 1. Capture the "before" snapshot at open time

`supabase/functions/night-agent/open.ts` already computes everything we need but only stores `{ tz, window, allowed_kinds }` in `night_shifts.summary`. Extend it to also persist:

```text
summary.gates              = { timezone, window, local_date, local_time,
                               enabled, in_window, blackout_hit,
                               allowed_kinds, blackout_dates }
summary.skip_reasons       = string[]   // shift-level (always [] if shift opened)
summary.candidates_total   = number
summary.candidates_skipped = [{ short_num, title, reason }]
summary.candidates_selected = [{ short_num, title, risk, phase, suite }]
```

Mirror the exact field names already used by `gates.ts` (test mode) so the report shape is consistent between dry-run and real runs.

### 2. Stamp each proposal with its lineage

When inserting into `night_proposals`, add to `payload`:
- `selected_at` (open timestamp)
- `gates_snapshot_ref` = shift_id (cheap join key — the snapshot lives on the shift row)

No schema migration required — both columns are jsonb.

### 3. Read endpoint

New route on `awip-api` (admin-only, mirrors `promotion-status` auth pattern):

- `GET /night-agent/promotion-audit?proposal_id=...` → returns:
  ```text
  {
    proposal: { id, status, decided_by, decided_at, rationale, target_ref },
    before: {
      shift_id, opened_at, gates, skip_reasons,
      candidates_total, candidates_selected, candidates_skipped
    },
    after: {
      audit_complete: { worst_severity, qa_passed, steps },
      observations: [...],   // 5-step trail for this job
      decision: "accepted" | "rejected"
    }
  }
  ```
- `GET /night-agent/promotion-audit?shift_id=...` → bulk variant (one entry per accepted/rejected proposal in that shift).

Pure assembly logic in a new `supabase/functions/awip-api/promotion_audit.ts` (unit-testable, no I/O — takes the rows and shapes them).

### 4. UI

New page `src/pages/PromotionAudits.tsx` at `/admin/promotion-audits`:
- Header: filter by date / shift / decision (accepted | rejected | pending).
- Table: one row per proposal — `#short_num`, title, decision, decided_by, worst_severity chip, shift date.
- Row click → drawer showing the report with two columns ("Before" / "After") and a candidates list with each candidate marked `selected`, `skipped (reason)`, or `promoted (the one this report is about)`.
- Reuse `VerdictPill` for severity, existing `SectionCard` styling.

Surface the same drawer from the existing `NightShifts` and `NightAgentCard` "Accept" buttons via a small "View audit" link on each accepted proposal — no duplicate UI.

### 5. Tests

`promotion_audit_test.ts` — feed a synthetic shift row + proposals + observations and assert the assembled report shape, including:
- Accepted proposal yields `after.decision = "accepted"` and includes the matching `audit_complete` observation.
- A skipped candidate appears in `before.candidates_skipped` with its reason verbatim.
- Missing `audit_complete` (legacy shift before this change) returns `after.audit_complete = null` instead of throwing.

## Files

New:
- `supabase/functions/awip-api/promotion_audit.ts`
- `supabase/functions/awip-api/promotion_audit_test.ts`
- `src/pages/PromotionAudits.tsx`
- `src/components/promotion/PromotionAuditDrawer.tsx`
- `src/lib/promotion-audit-types.ts`
- `docs/promotion-audit.md`

Edited:
- `supabase/functions/night-agent/open.ts` — enrich `night_shifts.summary` and `night_proposals.payload`.
- `supabase/functions/awip-api/index.ts` — register the new route.
- `src/App.tsx`, `src/components/AppSidebar.tsx` — link the new page.
- `src/pages/NightShifts.tsx`, `src/components/NightAgentCard.tsx` — "View audit" link on accepted proposals.
- `README.md`, `CHANGELOG.md`.

## Verification

1. Trigger `/night-agent/open` (test mode off) once; confirm `night_shifts.summary` contains `gates` + `candidates_selected`.
2. Accept one proposal in the UI; open the audit drawer; confirm Before shows the gate snapshot and Skipped list, After shows `audit_complete` + `decision=accepted`.
3. Reject another; confirm `decision=rejected` and the same Before snapshot is shared.
4. Hit the endpoint with an unknown `proposal_id` → 404; without admin role → 403.

## Risks

- Legacy shifts opened before this change will have `summary.gates = null`; the report endpoint returns `before.gates = null` with a `legacy: true` flag rather than failing.
- `night_shifts.summary` is jsonb so size is unbounded — cap `candidates_selected` / `candidates_skipped` at `MAX_JOBS_PER_SHIFT` (already enforced upstream).
