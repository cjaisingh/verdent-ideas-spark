## Goal

Tonight (22:00–06:00 UTC) should produce **visible roadmap progress** on phases 5 / 6 / 6b / 7 so domain work can start tomorrow. Today's overnight ran 95 phase-runner ticks but produced **zero** `roadmap_phase_overnight_runs` rows and only 1 night-eligible discussion action — the pipes are open, nothing is flowing through.

"Outsource" has two distinct meanings in AWIP and both apply:
- **Cloud outsource** — already live via `pickModel()` forcing every 22:00–06:00 UTC AI call to `google/gemini-2.5-flash-lite`. Verification only.
- **Local outsource (Gemma/Ollama)** — `ai_jobs` pipeline is scaffolded (tables + 5 edge fns + zod contracts + sentinel checks) but **0 workers, 0 jobs ever**. To actually offload work to your Mac, three things are missing: review UI, producer buttons, worker script.

## What's broken or empty right now

Verified from `automation_runs` (last 24h) and table state:

| Surface | State | Action |
|---|---|---|
| `night-agent-close` | 404 — cron hits a path the function doesn't expose | Fix route or cron URL |
| `scheduled-code-review` | 401 — missing service token header | Re-attach `AWIP_SERVICE_TOKEN` |
| `lessons-daily-synth` | 401 — missing auth | Same |
| `record-test-run` | 500 — integer overflow on a duration field (`356.16…`) | Cast column to bigint/numeric |
| `overnight-prequeue` | `partial` — 3 phases flagged, 0 runs produced | Diagnose + fix |
| `roadmap_phase_overnight_runs` | 0 rows in 7d | Direct consequence |
| `discussion_actions.night_eligible=true` | 1 row | Bulk-flag more |
| `phase-5` | `planned`, not `run_overnight` | Flag on |
| `ai_jobs` / `ai_workers` | empty | Stand the local worker up |

## Plan — tonight only

### Track A — Cloud night shift (repair + verify)

**A1. Unblock the 4 red cron jobs**
- `night-agent-close`: align cron URL to actual `/close` route.
- `scheduled-code-review` + `lessons-daily-synth`: re-add `x-awip-service-token` header in `cron.schedule`.
- `record-test-run`: change offending integer column to `bigint` (or round before insert).

**A2. Make the overnight phase runner produce work**
- Flag `phase-5` with `run_overnight = true` (6/6b/7 already on).
- Diagnose why `overnight-prequeue` returned `partial`. Either missing brief/contract scaffolding per phase, or the prequeue skips phases without a populated prompt. Fix so each of 5/6/6b/7 inserts ≥1 `queued` run before 22:00 UTC.

**A3. Widen night eligibility**
- Bulk-set `night_eligible = true` on open `discussion_actions` where `risk in ('low','medium')` and no blocking dep. Cap at `MAX_JOBS_PER_SHIFT = 50`. Critical/high gating unchanged.

**A4. Verify the cheap-model outsource is actually applied**
- After 06:00 UTC, query `ai_usage_log` for night-window rows; assert 100% use `gemini-2.5-flash-lite`. Patch any leaker to use `pickModel()`.

### Track B — Local Gemma (Ollama) outsource: make it actually work

The pipeline exists end-to-end on the server. What's missing is the **producer side** (something to put jobs on the queue), the **consumer side** (a worker script running on your Mac), and an **operator review surface**.

**B1. Worker script + first registration**
- Deliver `scripts/ollama-worker.ts` (Deno or Node) that: registers a worker row, polls `/ai-jobs-claim` every 5s, heartbeats every 60s, runs the prompt against local Ollama (`gemma2:9b` or `gemma2:2b` default), posts `/ai-jobs-complete` or `/ai-jobs-fail`. Reads `AWIP_SERVICE_TOKEN` + `SUPABASE_URL` from env.
- Single-page README in `docs/ai-jobs-ollama.md` (referenced in mem but not yet on disk) covering install + `ollama pull gemma2:9b` + `bun run scripts/ollama-worker.ts`.

**B2. `/admin/ai-jobs` review page**
- Queue panel (queued/claimed/done/failed counts + recent rows).
- Workers panel (last_seen_at, enabled, current job).
- Draft outputs panel — read `ai_draft_outputs` where `status='ready'`, with Approve / Reject / Edit buttons (writes back to source: changelog file, lesson, doc section).
- Sidebar entry under Admin → "Local AI jobs".

**B3. Producer buttons (so the queue isn't empty)**
- On `/admin/lessons` weekly synth row → "Draft with local Gemma" → enqueues `draft_lesson_synthesis` instead of running cloud synth.
- On `/admin/ai-usage` Credits tab → "Generate this week's changelog locally" → enqueues `draft_changelog_entry`.
- On any open `doc_drift` finding → "Draft doc section" → enqueues `draft_doc_section`.
- All enqueues go through existing `ai-jobs-enqueue` with operator JWT and idempotency key.

**B4. Wire local jobs into night-shift policy (consistency)**
- Between 22:00–06:00 UTC, the overnight phase runner should *prefer* an available local worker when one is `enabled` and `last_seen_at < 5min`; fall back to cloud `pickModel()` otherwise. Single new helper `preferLocalWorker()` in `_shared/model-policy.ts`.
- Local completions still write to `ai_usage_log` (job=`ollama-worker`, cost=$0) so the Credits panel shows the outsourcing savings as a visible delta tomorrow.

### Track C — Morning verification (06:30 UTC)

- `/admin/night-shift` — all rows green.
- `roadmap_phase_overnight_runs` ≥ 4 completed (one per phase).
- `/admin/ai-jobs` — at least 1 local-Gemma draft visible (assuming worker was running).
- `ai_usage_log` night window: 100% flash-lite for cloud rows; any `ollama-worker` rows = bonus savings.
- Morning Review surfaces the night digest with both cloud and local lines.

## Technical notes

- **Files touched (Track A):** one migration (eligibility bulk-flag + `record-test-run` column type + `phase-5.run_overnight`), one cron SQL update (headers + `/close`), possibly small edit to `overnight-prequeue/index.ts`.
- **Files touched (Track B):** `scripts/ollama-worker.ts` (new), `docs/ai-jobs-ollama.md` (new), `src/pages/AdminAiJobs.tsx` (already exists — fill in the review surface), 3 producer buttons across existing admin pages, one helper in `_shared/model-policy.ts`.
- **No new tables, no new edge functions, no new secrets.** Worker script reads existing `AWIP_SERVICE_TOKEN`.
- **Idempotency** preserved — `ai-jobs-enqueue` and `overnight-prequeue` already dedupe.
- **Risk:** If your Mac isn't online overnight, Track B falls back to cloud cleanly via `preferLocalWorker()` — no work lost.

## What I need from you to start

1. Confirm you want **both** tracks tonight (A + B), or just A.
2. For Track B: which Gemma tag should the worker default to (`gemma2:2b` fast / `gemma2:9b` balanced / `gemma3:12b` if you've pulled it)?
3. Confirm your Mac will be on and reachable 22:00–06:00 UTC tonight, otherwise B1 worker can wait and we just ship B2+B3 so it's ready for tomorrow.