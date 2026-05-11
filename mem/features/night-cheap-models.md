---
name: night-cheap-models
description: Night window 22:00–06:00 UTC forces all AI jobs to gemini-2.5-flash-lite via _shared/model-policy.ts; "Run overnight" queues approved phases for observation-only AI briefings.
type: feature
---
**Window**: 22:00–06:00 UTC (matches Night Agent window). Detected via `_shared/model-policy.ts → isNightUTC()`.

**Helper**: `pickModel(daytimeModel, { force? })` returns `google/gemini-2.5-flash-lite` if night or `force:true`, else the daytime model. Each AI usage row gets `request_ref.night_mode` so the spend chart can highlight night calls.

**Wired in**:
- `daily-plan` (was already flash-lite, now goes through helper)
- `scheduled-code-review` (daytime gemini-2.5-flash → flash-lite at night)
- `discussion-extract-actions` (daytime gemini-2.5-flash → flash-lite at night)
- `companion-extract-actions`, `lessons-synthesize`, `awip-reviews-pull`, `snapshot-daily-report` (all daytime gemini-2.5-flash → flash-lite at night)
- `route-operator-message:reply` (daytime gpt-5-mini → flash-lite at night)
- `awip-api:analyze-transcript` (daytime gemini-2.5-pro → flash-lite at night)
- `finding-discuss-copilot` (daytime gemini-2.5-pro → flash-lite at night)
- `overnight-phase-runner` (always forced to flash-lite)

**Overnight phase queue**:
- Table `roadmap_phase_overnight_runs` (operator-only RLS, realtime).
- Operator clicks **Run overnight** in `PhaseSignoffAudit` → row inserted (`status=queued`).
- Cron `overnight-phase-runner-15m` (every 15 min) calls edge function `overnight-phase-runner`; the function exits early if outside the night window unless an explicit `run_id` is supplied.
- Runner generates an observation-only briefing (summary, risks, recommendations) for the phase; result stored on the row. **No roadmap mutation.**
- Cancel via `cancel_overnight_run(_id)` RPC (operator-owned queued rows only).

**UI**:
- `src/components/roadmap/OvernightRunControl.tsx` — button + status badge + result popover, embedded per signoff row.
- `OvernightQueueCard` in `AutomationPanel` — "next up" + "recent runs" with model + cost.
