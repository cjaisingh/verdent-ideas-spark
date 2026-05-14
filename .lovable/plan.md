## Honest read

You're right about the drift. Three concrete facts:

- `docs/workstream-success-metrics.md` defines **WS1–WS6 only**. **W7 was bolted on** mid-flight with no acceptance criteria, no KPIs, no SLOs, no "done" line.
- Backlog is actually small: **4 open sentinel findings, 1 open discussion_action, 13 cancelled**. Not a crisis — the noise is from us not closing the W7 loop, not from rot.
- We've shipped W7.1, W7.1.5, W7.2 as substrate but **nothing reads from it**. `governance_coverage()` returns 0% by design and no flow forces it upward. That's why it feels endless — there's no exit condition.

So: don't kill W7, but **define what "done" means**, finish that, then formally close it. No W7.3, W7.4, W7.5 — those go on a backlog until a domain module asks for them.

## Plan: "W7 Governance — Closeout"

### Step 1 — Re-scope (doc-only, no code)
1. Add **WS7 — Governance Substrate** to `docs/workstream-success-metrics.md` with:
   - **Acceptance criteria (4 binary checks):** ontology page live; `decision_authorities` + `resolve_truth()` callable; `governance_links` + `/governance` page live; claims pipeline live with at least one real claim source.
   - **One KPI:** `governance_coverage(30).with_authority_rule / tasks_shipped` ≥ a target we agree (proposed: **40%** for closeout, ratcheting later).
   - **One SLO:** `truth_conflicts_unresolved` open > 7 days → already wired.
2. Update `docs/master-plan.md` to mark **W7.3/W7.4 deferred** with a one-line reason ("revisit when a domain module needs decay or operator-reliability signal"). Removes the gravitational pull.
3. CHANGELOG entry.

### Step 2 — Make the substrate produce signal (small, finite)
Three things, all using existing tables — no new substrate:

1. **Auto-link on promotion.** When `discussion_actions.promoted_task_id` is set, auto-insert a `governance_links` row `task ↔ entity` if the action's title/payload mentions a known entity (regex match against `docs/ontology.md` entity names). Trigger on `discussion_actions` UPDATE. This alone moves coverage off 0% without backfill.
2. **One real claim source.** Wire `automation_runs` → `claims-ingest` for the `TestRun` entity (CI is already declared the hard owner in W7.1 defaults). Every successful test run files a claim with `source='ci'`, `confidence=1.0`. Proves the pipeline carries production traffic, not just operator-typed JSON.
3. **`/governance` coverage badge** on the sidebar — small chip showing current 30-day coverage %. Makes the gap visible without anyone opening the page.

### Step 3 — Triage backlog in the same pass (≤ 1 hour)
- 4 open sentinel findings → I read them, propose ack/resolve/escalate per finding, you click through.
- 1 open discussion_action → same.
- Reconcile 13 cancelled actions: confirm none are actually still wanted.

### Step 4 — Sign off W7 and stop
- Verify the 4 acceptance checks pass.
- Verify coverage KPI is non-zero (Step 2.1+2.2 should put it in the 20–50% range without manual work).
- Mark `roadmap_phases` row for W7 done via the proper sign-off flow (not manual update).
- Write a short `docs/w7-closeout.md` listing what's deferred and why.

## What this plan deliberately does NOT do

- ❌ No FM domain module. Per your direction.
- ❌ No W7.3 (confidence decay), W7.4 (operator reliability), W7.5+. Deferred to backlog.
- ❌ No backfilling historical `governance_links` for already-shipped tasks. Coverage starts climbing from new work only.
- ❌ No new tables. We use what exists.
- ❌ No edits to `claims-ingest` schema or `resolve_truth()` logic.

## Estimated scope

Step 1: 1 turn (docs).
Step 2: 2–3 turns (1 trigger migration, 1 small edge function change, 1 sidebar chip).
Step 3: 1 turn (interactive triage with you).
Step 4: 1 turn.

Total: **~5 turns** to formally close W7 with a defensible "done".

## Decision needed before I start

- **Coverage target for closeout** — I proposed 40% over 30d. Lower (e.g. 20%) closes faster but signals weaker; higher (60%+) likely needs backfill. Your call.
- **CI → claims wiring** — confirm `automation_runs.job` rows for `record-test-run` should fire claims for the `TestRun` entity. If you'd rather start with a different entity (e.g. `RoadmapTask` from `roadmap_task_activity`), say which.
