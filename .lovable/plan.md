
## Answering your questions first

**1. Are the suggestions ("Add skip filters", "Link skips to turns", "Add CSV export", "Fix security linter") on the roadmap?**
No. The roadmap currently only tracks Phase 1–4 module work (approvals, module split, telegram move, voice). None of the recent auto-log / skips / audit work is represented as tasks, and nothing is being logged against `roadmap_work_log` for the sessions that built it. Right now the roadmap is drifting from what we are actually building.

**2. Code reviews by GitLab / another AI on a regular basis?**
We are on GitHub (CI workflows already exist). We don't currently run any AI review. Recommend adding a lightweight scheduled review pass (weekly) using Lovable AI Gateway — cheap, no extra keys — that posts findings as roadmap comments. It is worth doing; not urgent.

**3. Scheduled testing?**
Vitest + e2e suites exist but only run on push via `.github/workflows/ci.yml`. No nightly/scheduled run, no record of green/red over time. Worth a nightly cron + a "last test run" tile on the roadmap.

**4. Scheduled QA validation against goals?**
Nothing today. The master plan has phase success criteria but nothing checks them. Worth adding a recurring QA checklist tied to each active phase.

---

## Plan

### A. Put the meta-work on the roadmap (so it gets tracked)
Add a new sprint **`s2.4 — Operator observability & hygiene`** under Phase 2 with these tasks:

1. `t1` Add skip filters (by source / reason / date) to `SkipsPanel`
2. `t2` Link each skip row back to the originating turn (store `turn_id` / open task)
3. `t3` CSV export for skips and work-log
4. `t4` Fix outstanding Supabase security linter warnings
5. `t5` Auto-log this meta-work itself (TurnTracker entries against the new sprint)

Migration: `INSERT` rows into `roadmap_sprints` + `roadmap_tasks`. No schema change.

### B. Make sure these get logged
- Default `TurnTracker` task selection to the active sprint when one is set, so we stop forgetting to attach turns.
- Add a small "unlogged turns this week" counter on `/roadmap` so drift is visible.

### C. Scheduled AI code review (weekly)
- New edge function `scheduled-code-review` invoked by a `pg_cron` weekly job.
- Pulls the last 7 days of git diff via GitHub API (token already in CI), sends to `google/gemini-2.5-pro` via Lovable AI Gateway, writes findings into a new `roadmap_review_findings` table (RLS: operator read).
- Surface count + latest 5 findings in a "Code review" card on `/roadmap`.

### D. Scheduled tests
- Add `.github/workflows/nightly.yml` running `vitest run` + `vitest -c vitest.e2e.config.ts run` on cron.
- Edge function `record-test-run` (called from the workflow) writes pass/fail + duration into a new `test_runs` table.
- "Last test run" chip on `/roadmap` (green/red + timestamp + link).

### E. Scheduled QA validation
- New table `qa_checks` (one row per phase success criterion from `docs/master-plan.md`, status: `pass | fail | unknown`, last_checked_at, note).
- Weekly `pg_cron` calls `qa-validate` edge function which:
  - For mechanical criteria (e.g. "every API call logged"), runs a SQL probe.
  - For judgement criteria, opens a roadmap comment asking the operator to tick it off.
- "Phase health" panel on `/roadmap` showing each active phase's criteria status.

### F. Cadence proposal (for you to confirm)
- **Code review:** weekly, Mondays 06:00 UTC
- **Full test suite:** nightly 02:00 UTC
- **QA validation sweep:** weekly, Fridays 16:00 UTC
- **Roadmap hygiene check (unlogged turns):** daily, surfaced as a chip — no notification

---

## Technical notes
- Reuse `roadmap-log-work` source enum; add `'scheduled_review'` and `'qa_validator'` for E2E auditability of automated activity.
- All new tables: RLS operator-only, realtime enabled (matches existing pattern).
- All new edge functions: `verify_jwt = true` except cron-invoked ones, which use the service token already used by `awip-api`.
- pg_cron + pg_net extensions need enabling in a migration.

---

## Out of scope this pass
- GitLab integration (we're on GitHub; happy to add if you switch).
- Slack/Telegram notifications for failed test runs (easy follow-up once `test_runs` exists).
- Auto-fixing review findings.

Approve and I'll do A + B in the first pass (cheap, immediately useful), then C/D/E in a follow-up so you can review each cron in isolation.
