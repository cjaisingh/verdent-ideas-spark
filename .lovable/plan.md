# Night-cheap models + overnight phase queue

## Goal
Between **22:00–06:00 UTC** (the existing Night Agent window), every AI job uses `google/gemini-2.5-flash-lite`. Add a "Run overnight" button on approved roadmap phases that queues them to execute in that window with the cheap model.

## Part 1 — Shared night-model helper

New file `supabase/functions/_shared/model-policy.ts`:

```ts
export const NIGHT_MODEL = "google/gemini-2.5-flash-lite";
export function isNightUTC(d = new Date()) {
  const h = d.getUTCHours();
  return h >= 22 || h < 6;
}
export function pickModel(daytime: string, opts: { force?: boolean } = {}) {
  if (opts.force) return NIGHT_MODEL;
  return isNightUTC() ? NIGHT_MODEL : daytime;
}
```

Wire it in:
- `daily-plan/index.ts` — replace `PLANNER_MODEL` constant with `pickModel("google/gemini-2.5-flash-lite")` resolved per request (no behavior change today, future-proofs if planner is upgraded).
- `scheduled-code-review/index.ts` — replace `REVIEWER_MODEL` with `pickModel("google/gemini-2.5-flash")`. Pass the resolved model into `ai_usage_log` and the cost-threshold payload so the swap is auditable.
- `discussion-extract-actions/index.ts` — same pattern around the `model: "google/gemini-2.5-flash"` call.

Log a `night_mode: true` flag on `ai_usage_log.meta` (existing jsonb column) when the helper returned the night model so the spend chart on `/dashboard` can highlight it.

## Part 2 — "Run overnight" on approved phases

### Schema
New migration:
```sql
create table public.roadmap_phase_overnight_runs (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.roadmap_phases(id) on delete cascade,
  phase_key text not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  scheduled_for date not null,           -- the UTC date whose night window will pick it up
  status text not null default 'queued', -- queued | running | done | failed | cancelled
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);
alter table public.roadmap_phase_overnight_runs enable row level security;
create policy "operators read overnight runs" on public.roadmap_phase_overnight_runs
  for select to authenticated using (has_role(auth.uid(),'operator'));
create policy "operators queue overnight runs" on public.roadmap_phase_overnight_runs
  for insert to authenticated with check (has_role(auth.uid(),'operator') and requested_by = auth.uid());
create policy "no client update/delete" on public.roadmap_phase_overnight_runs
  for all to authenticated using (false) with check (false);
alter publication supabase_realtime add table public.roadmap_phase_overnight_runs;
```

Worker auth uses `AWIP_SERVICE_TOKEN` (same pattern as other cron jobs).

### Edge function `overnight-phase-runner` (new)
- Cron every 15 min between 22:00–06:00 UTC.
- Picks `status='queued'` rows where `scheduled_for <= today_utc`.
- For each: marks `running`, calls the existing AI pipeline with `pickModel(..., { force: true })`, writes `result`/`error`, marks `done`/`failed`. Idempotency-key = run id.
- Refuses to run a phase whose `roadmap_phase_signoffs` row is missing (defense in depth — UI already blocks it).

### UI
- `src/components/roadmap/ProceedAction.tsx` (or `PhaseSignoffAudit.tsx` — whichever surfaces the approved state) gets a `Run overnight` button, disabled unless: phase has a signoff row AND no `queued`/`running` row exists for it.
- New `src/components/roadmap/OvernightRunBadge.tsx` shows queued/running/done state, last result, and a "Cancel" action (soft-cancel via insert of a `cancelled` status row — kept simple by allowing operator update via an RPC `cancel_overnight_run(_id uuid)` since direct update is blocked by RLS).
- Realtime subscription on `roadmap_phase_overnight_runs` so the badge updates live.

### Dashboard
Add a small **Overnight queue** card to `AutomationPanel.tsx` listing the next night's queued phases + last 5 completed runs (model used, cost from `ai_usage_log` joined by run id stored in meta).

## Part 3 — Memory + docs
- Update `mem://index.md` Core: append "Night window 22:00–06:00 UTC also forces all AI jobs to `gemini-2.5-flash-lite` via `_shared/model-policy.ts`."
- Add `mem://features/night-cheap-models.md` describing the helper, the overnight phase runner, and the queue table.
- Append CHANGELOG entry under the existing automation section.

## Out of scope
- No change to daytime models or per-job thresholds.
- No automatic queueing — operator must click "Run overnight" per phase.
- No timezone configurability (UTC only, matches Night Agent).

## Validation
1. Unit-call `pickModel` with mocked `Date` for 21:59 / 22:00 / 05:59 / 06:00 UTC.
2. `curl_edge_functions` against `scheduled-code-review` at night, confirm `ai_usage_log.model = gemini-2.5-flash-lite` and `meta.night_mode = true`.
3. Queue a phase via UI → check row appears → manually invoke `overnight-phase-runner` with service token → row flips to `done`, result rendered in badge.
