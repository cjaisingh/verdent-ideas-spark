---
name: overnight-recommender
description: Daily 21:30 UTC suggester of which roadmap phases to run overnight; writes overnight_recommendations rows; operator must click Queue.
type: feature
---

**Cron**: `scheduled-overnight-recommender` 21:30 UTC → edge function `overnight-recommender` (auth `x-service-token`). Manual refresh button on `/master-plan` invokes with operator JWT.

**Heuristics** (pure SQL, no AI):
- Eligible: phase status not in (`shipped`,`done`,`cancelled`), `run_overnight=false`, has ≥1 signoff, no queued/running run for tomorrow, last successful run ≥3 days ago, no open `discussion_actions` (subject_type=task) with `risk='critical'`, no open `risk='high'` actions without `night_override_reason`.
- Score: 40 base, +20 zero high-risk, +20 never-run-or->7d, +20 ≥3 open tasks.

**Storage**: `overnight_recommendations(scheduled_for, phase_id, score, reasons[], blockers[], status open|queued|dismissed|expired, acted_at, acted_by)` — unique on `(scheduled_for, phase_id)`. Operator/admin SELECT+UPDATE; system-only INSERT; no client DELETE. Realtime ON. 14-day retention.

**UI**: `OvernightCandidatesCard` at top of `/master-plan` (Queue → inserts `roadmap_phase_overnight_runs` row + flips rec to `queued`; Dismiss → flips to `dismissed`). One-line retro under Morning Review KPIs (`OvernightRetroLine`).

**Why**: `overnight-phase-runner` was processing 0 phases nightly because nothing was flagged `run_overnight=true`. Recommender turns the decision into one click without auto-queuing.
