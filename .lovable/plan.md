## Goal

Stop leaving the overnight phase runner idle. Each night, recommend which active phases would be safe + valuable to run overnight. Operator still clicks to enable — no auto-queue.

## What gets built

### 1. New edge function: `overnight-recommender`

- Schedule: cron `scheduled-overnight-recommender` at **21:30 UTC** (25 min before `overnight-prequeue` at 21:55).
- Auth: `x-service-token` (cron) or operator JWT (manual "Refresh recommendations" button).
- Wrapped with `withLogger`. Logs to `automation_runs` (job `overnight-recommender`).

**Selection heuristics** (pure SQL, no AI — keeps cost ≈ 0):
- `roadmap_phases.status` NOT IN (`shipped`, `done`, `cancelled`)
- Phase has ≥1 row in `roadmap_phase_signoffs` (runner requires this anyway)
- Phase is NOT already flagged `run_overnight=true` (those auto-queue via prequeue)
- No queued/running row in `roadmap_phase_overnight_runs` for tomorrow
- Last successful overnight run for this phase was ≥3 days ago (or never)
- Among the phase's open `roadmap_tasks` joined via `roadmap_sprints`:
  - 0 tasks linked to `discussion_actions.risk='critical'`
  - 0 tasks linked to `discussion_actions.risk='high'` without `night_override_reason`

**Confidence score** (0–100, simple weighted sum):
- +40 baseline if eligible
- +20 if phase has zero open high-risk linked actions
- +20 if last run was ≥7 days ago (or never)
- +20 if open task count ≥ 3 (more value to a briefing)

Returns: list of `{phase_id, phase_key, title, score, reasons[], blockers[]}` plus phases rejected with reasons (for transparency in the UI).

### 2. New table: `overnight_recommendations`

```text
id uuid pk
generated_at timestamptz default now()
scheduled_for date              -- the night this batch covers (= tomorrow UTC date)
phase_id uuid
phase_key text
score int
reasons jsonb                   -- ["signoff present","no high-risk open"]
blockers jsonb                  -- empty when eligible
status text default 'open'      -- open | queued | dismissed | expired
acted_at timestamptz
acted_by uuid
unique (scheduled_for, phase_id)
```

- RLS: operator/admin SELECT/UPDATE; insert via service role only.
- Realtime ON.
- Old rows (`scheduled_for < today - 14 days`) purged by existing retention sweep — add to `retention_settings`.

### 3. UI: Master Plan panel

Component `OvernightCandidatesCard` on `/master-plan`:
- Lists tonight's `open` recommendations sorted by score desc.
- Each row: phase title + key, score badge, "why" reasons, two buttons:
  - **Queue for tonight** → inserts row into `roadmap_phase_overnight_runs` (scheduled_for=tomorrow, status=queued, requested_by=auth.uid()), marks recommendation `queued`.
  - **Dismiss** → marks `dismissed` with `acted_by`.
- Empty state: "No overnight candidates tonight" with last-generated timestamp.
- "Refresh now" button → invokes recommender with operator JWT.

### 4. UI: Morning Review retrospective line

In `MorningReview.tsx` (today tab), add a small line under the existing summary:
> "Last night: 2 phases were recommended, 1 ran, 1 was dismissed."

Pulled from `overnight_recommendations` where `scheduled_for = yesterday`.

### 5. Docs + memory

- New `docs/overnight-recommender.md`
- Append to `docs/automation.md` cron table
- Update `mem/features/night-cheap-models.md` to note the recommender
- Add cron job name to Core memory cron list
- CHANGELOG entry

## Out of scope (explicit non-goals)

- No auto-queueing. Recommender only suggests.
- No AI calls — pure SQL heuristics. Zero ongoing cost.
- No changes to `overnight-phase-runner` or `overnight-prequeue` logic.
- No new risk gates — reuses existing `discussion_actions.risk` + `enforce_night_eligibility_by_risk`.

## Acceptance

- 21:30 UTC tonight: `overnight-recommender` runs, writes 0–N rows into `overnight_recommendations` for tomorrow's date, logs to `automation_runs`.
- `/master-plan` shows the candidates card with working Queue + Dismiss buttons.
- Clicking Queue inserts a `roadmap_phase_overnight_runs` row that the existing 15-min runner picks up after 22:00 UTC.
- Morning Review shows the previous night's recommend → ran/dismissed tally.
- Re-running the recommender is idempotent (unique on `scheduled_for, phase_id`).
