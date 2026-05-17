---
name: ai-jobs-ollama
description: Pull-based queue (ai_jobs/ai_job_results/ai_draft_outputs/ai_workers) for outsourcing drafts to a local Ollama worker; Lovable stays architect/reviewer
type: feature
---
Slice 1 scope: three draft kinds — `draft_changelog_entry`, `draft_lesson_synthesis`, `draft_doc_section`. Slice 2 adds `codemod_replace_any` (file-scoped TypeScript any → narrow type, output is a unified diff). All outputs land in `ai_draft_outputs` as `status='ready'` for operator approve/reject. No auto-merge, no code generation outside the diff.

**codemod_replace_any enqueuer**: `supabase/functions/codemod-any-enqueue` (x-awip-service-token). Caller (GH Actions or local script) runs eslint with `no-explicit-any: error`, buckets findings by file, posts `{git_sha, files:[{file_path, ts_source, any_sites:[{line,col,snippet,hint?}], surrounding_types?}]}`. Caps: 40 sites/file, 30 jobs/call. Idempotency key `codemod-any:sha256(file_path:git_sha)`. Priority 200 (lower than draft_*). Tracked by discussion_action #20 ("no-explicit-any cleanup").

**Tables**: `ai_workers` (registered boxes), `ai_jobs` (queue, idempotency_key UNIQUE, heartbeat/attempts/max_retries=3), `ai_job_results` (per attempt), `ai_draft_outputs` (reviewable). Operator-only RLS; realtime on `ai_jobs` + `ai_draft_outputs`.

**Edge functions** (all `withLogger`): `ai-jobs-enqueue` (operator JWT, idempotent), `ai-jobs-claim`/`-heartbeat`/`-complete`/`-fail` (x-service-token = AWIP_SERVICE_TOKEN). Claim uses select+update with `WHERE status='queued'` race-safe fallback (no atomic RPC yet — fine for single-worker).

**Contracts**: `supabase/functions/_shared/contracts/ai-jobs.ts` — zod schemas + `buildPrompt()` + `projectDraft()` per kind. Add new kinds here first.

**Sentinel** (`sentinel-tick`): calls `reclaim_stale_ai_jobs(10)` then runs `checkAiJobsStuck` (>10min stale heartbeat → medium/high) and `checkAiWorkersOffline` (enabled worker >15min silent AND queue>0 → medium).

**Usage logging**: complete handler inserts into `ai_usage_log` with `job='ollama-worker'`, model=ollama tag, so credits panel shows local spend as $0.

**Still to build**: `/admin/ai-jobs` review page, producer buttons on `/admin/lessons` + `/admin/ai-usage`, the worker script artefact, `docs/ai-jobs-ollama.md`.

**Worker contract** (for the script that will live outside repo):
1. POST `/ai-jobs-claim` `{worker_name, model_tags}` → 204 or `{job:{id,kind,requested_model,prompt:{system,user}}}`.
2. While running, POST `/ai-jobs-heartbeat` `{job_id, worker_name}` every 60s.
3. POST `/ai-jobs-complete` `{job_id, output_text, model, tokens_in, tokens_out, latency_ms}` OR `/ai-jobs-fail` `{job_id, error}`.
4. Headers: `x-service-token: $AWIP_SERVICE_TOKEN`.
