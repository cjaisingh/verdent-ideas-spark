# Overnight Recommender

A nightly suggester that flags roadmap phases worth running overnight. **Observation only** — operator clicks to queue. No auto-queueing. No AI calls.

> Per-phase overnight behaviour + morning checks: see [`docs/phases-overnight-operator-guide.md`](./phases-overnight-operator-guide.md).


## Cadence

Cron job `scheduled-overnight-recommender` runs daily at **21:30 UTC**, 25 minutes before `overnight-prequeue` (21:55 UTC).

## Pipeline

1. Scan `roadmap_phases` where status NOT IN (`shipped`, `done`, `cancelled`) AND `run_overnight = false` (phases already flagged auto-queue via prequeue, so we skip them).
2. For each candidate, compute **blockers**:
   - No row in `roadmap_phase_signoffs` → blocked.
   - Already has a `queued`/`running` row in `roadmap_phase_overnight_runs` for tomorrow → blocked.
   - A successful run finished in the last 3 days → blocked (avoid spam).
   - Any open `discussion_actions` with `subject_type='task'`, linked to a phase task, with `risk='critical'` → blocked.
   - Any open `discussion_actions` with `risk='high'` and no `night_override_reason` → blocked.
3. If no blockers, compute a **score (0–100)**:
   - +40 baseline (eligible)
   - +20 if zero high-risk open actions
   - +20 if never run overnight, or last run >7 days ago
   - +20 if phase has ≥3 open tasks (more value to a briefing)
4. Upsert into `overnight_recommendations` (unique on `scheduled_for, phase_id`).

Blocked phases are recorded in the `automation_runs.detail.skipped_detail` array (first 20) for transparency, but **not** persisted as recommendations.

## Storage

Table `public.overnight_recommendations`:

| column | notes |
|---|---|
| `scheduled_for` | the night the suggestion covers (= tomorrow UTC at gen time) |
| `phase_id`, `phase_key` | target phase |
| `score`, `reasons[]`, `blockers[]` | why we suggested it |
| `status` | `open` → `queued` (operator clicked) / `dismissed` / `expired` |
| `acted_at`, `acted_by` | audit trail |

RLS: operator/admin SELECT/UPDATE; insert via service role only; never deletable from clients. Realtime ON. Retained 14 days via `retention_settings`.

## UI

- **`/master-plan`** — `OvernightCandidatesCard` at top of page lists tonight's open suggestions sorted by score, with **Queue for tonight** + **Dismiss** buttons. "Refresh" button manually invokes the edge function.
- **`/morning-review`** (Yesterday tab) — One-line retrospective under the KPIs: *"Last night: 3 overnight candidates suggested · 1 queued · 2 dismissed."*

## Auth

- Cron: `x-service-token` from `app_secrets.AWIP_SERVICE_TOKEN`.
- Manual refresh: operator JWT.

## Cost

Pure SQL. Zero AI spend. Per-run cost ≈ network only.

## Why this exists

The `overnight-phase-runner` was built but the only way to feed it was for the operator to manually flag `roadmap_phases.run_overnight=true`. Result: night after night, the runner found 0 eligible phases and the capability went idle. This recommender surfaces the candidates so the decision is one click instead of a manual SQL hunt.
