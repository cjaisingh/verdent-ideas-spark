---
name: ai-jobs-ollama
description: Pull-based queue (ai_jobs/ai_job_results/ai_draft_outputs/ai_workers) for outsourcing drafts to a local Ollama worker; Lovable stays architect/reviewer. Default model gemma4.
type: feature
---
Slice 1 scope: three draft kinds — `draft_changelog_entry`, `draft_lesson_synthesis`, `draft_doc_section`. Slice 2 adds `codemod_replace_any`. All outputs land in `ai_draft_outputs` as `status='ready'` for operator approve/reject. No auto-merge.

**Worker script**: `scripts/ollama-worker.mjs` (also mirrored to `/mnt/documents/ollama-worker/worker.mjs` with README + .env.example). Zero npm deps, Node 18+. Default model `gemma4`, configurable via `DEFAULT_MODEL` env. Polls every 5s, heartbeats every 20s, 5-min per-job timeout.

**Run**: `node --env-file=.env scripts/ollama-worker.mjs`. Required env: `SUPABASE_URL`, `AWIP_SERVICE_TOKEN`, `WORKER_NAME`. Survives sleep — `sentinel-tick` reclaims stale claims after ~10min via `reclaim_stale_ai_jobs()`.

**codemod_replace_any enqueuer**: `supabase/functions/codemod-any-enqueue` (x-awip-service-token). Caps: 40 sites/file, 30 jobs/call. Priority 200.

**Tables**: `ai_workers`, `ai_jobs` (idempotency_key UNIQUE, max_retries=3), `ai_job_results`, `ai_draft_outputs`. Operator-only RLS; realtime on `ai_jobs` + `ai_draft_outputs`.

**Edge functions** (all `withLogger`): `ai-jobs-enqueue` (operator JWT), `ai-jobs-claim`/`-heartbeat`/`-complete`/`-fail` (x-service-token).

**Contracts**: `supabase/functions/_shared/contracts/ai-jobs.ts` — zod schemas + `buildPrompt()` + `projectDraft()` per kind.

**Producer buttons live**: `/admin/lessons` (synth), `/admin/ai-usage` (changelog + doc section) via `EnqueueDraftDialog`.

**Review surface live**: `/admin/ai-jobs` (Jobs/Drafts/Workers tabs, 516 lines, realtime).

**Sentinel** (`sentinel-tick`): `reclaim_stale_ai_jobs(10)` + `checkAiJobsStuck` (>10min stale heartbeat) + `checkAiWorkersOffline` (>15min silent AND queue>0).

**Usage logging**: complete handler inserts `ai_usage_log` with `job='ollama-worker'`, cost=$0.
