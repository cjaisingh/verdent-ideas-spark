# W7 Governance Substrate — Closeout

**Status:** closed
**Date:** 2026-05-14
**Scope locked at:** W7.1, W7.1.5, W7.2 + closeout (Step 2c, Step 3)
**Deferred:** W7.3 (confidence decay), W7.4 (operator reliability) — revisit when a domain module needs the signal.

---

## Why this doc exists

W7 was bolted on mid-flight without acceptance criteria. `docs/workstream-success-metrics.md` originally defined WS1–WS6 only. Without a "done" line, the workstream had infinite gravity. This document is the formal exit.

The agreed exit criteria, KPIs and SLO are recorded in `docs/workstream-success-metrics.md` under **WS7 — Governance Substrate** and weighted at 12% of the OMI.

---

## Acceptance checks

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Ontology page live | Pass | `/ontology`, source `docs/ontology.md`, 11 entities |
| 2 | `decision_authorities` + `resolve_truth()` callable | Pass | 24 authority rules registered, resolver used by `claims-ingest` |
| 3 | `governance_links` + `/governance` page live | Pass | 151 links, `/governance` mounted with chain walker + coverage rollup |
| 4 | Claims pipeline carries real traffic | Pass | 24 real claims (`system`=20, `ci`=4) from `automation_runs` and `roadmap_task_activity` triggers |

The W7 sign-off checklist on `/governance` reflects these checks live.

---

## KPIs (30-day window)

| KPI | Target | Actual | Status |
|---|---|---|---|
| Governance coverage (`with_authority_rule / tasks_shipped`) | ≥ 60% | ~100% (19/19) post-backfill | Pass |
| Real-claim ratio (`ci+system / total claims`) | ≥ 70% | 100% (24/24) | Pass |
| Truth-conflict MTTR (p50) | ≤ 7d | n/a — no unresolved conflicts open | Pass |

Coverage was lifted by the **W7 closeout backfill**: `auto_link_promoted_task` trigger on `discussion_actions` + historical link of 150 promoted tasks. New work auto-links going forward; no further backfill planned.

---

## SLO

`truth_conflicts_unresolved > 7d` → already wired to the sentinel. Currently 0 open.

---

## Step 2c — Sidebar coverage chip

- New hook `src/hooks/useGovernanceCoverage.ts` calls `governance_coverage(30)` with a 5-min in-memory cache.
- `src/components/AppSidebar.tsx` renders a colour-coded chip next to **Knowledge → Governance** (and the favourites row when pinned).
- Bands: green ≥ 60%, amber ≥ 30%, red below.
- Currently shows **100%**.

---

## Step 3 — Backlog triage

Closed in the same pass:

| Item | Disposition |
|---|---|
| `whats_new_drafts_stale` sentinel finding | Resolved as operational noise — `/whats-new` view exists for the workflow. |
| 3 × `cron_silence` findings (`scheduled-morning-review`, `scheduled-sentinel-tick`, `overnight-phase-runner-15m`) | Grouped under new tracked `discussion_action` **"Reactivate stalled crons"** (high/high). Findings stay open until next successful run. |
| Discussion action #20 (eslint `no-explicit-any` cleanup) | Left open — gated cleanup, governed by `mem://preferences/lint-policy`. |
| 13 cancelled discussion actions | Reviewed — none reopened. |

---

## What is explicitly **not** in scope

- ❌ FM domain module.
- ❌ W7.3 confidence decay, W7.4 operator-reliability signal, W7.5+.
- ❌ Backfilling historical `governance_links` beyond the promoted-task auto-link.
- ❌ Editing UI for `decision_authorities` — rules remain git-versioned via migrations + CHANGELOG.
- ❌ Schema changes to `claims-ingest` or `resolve_truth()` logic.

If a future domain module needs decay or operator-reliability signal, open a fresh workstream — do not reopen W7.

---

## Sign-off

- Acceptance: 4/4 pass.
- KPIs: 2/2 pass, SLO clean.
- Sidebar chip live, backlog triaged, this doc written.
- Next step: mark the `roadmap_phases` row for W7 done via the standard sign-off flow (PhaseGate → ProceedAction).

W7 is **closed**. Substrate stays; gravity gone.
