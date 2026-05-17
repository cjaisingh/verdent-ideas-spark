
# Outsource drafting work to local Ollama

## Roles

- **Lovable (me)** — architect, planner, schema/contract author, reviewer of outputs. No change to how I work today.
- **Ollama box (your laptop)** — stateless worker. Pulls jobs, runs the local model, posts results back. Never holds secrets beyond a service token.
- **Lovable Cloud** — queue, auth, audit. No direct outbound to your box.

Out of scope for slice 1: full code generation, anything that mutates the repo, OpenRouter, tunnels.

## Slice 1 — Doc/changelog/lesson drafting

Three job kinds only, all "produce text, attach to a record":
1. `draft_changelog_entry` — input: list of recent merged commits/migration filenames in a window. Output: markdown block for `CHANGELOG.md`.
2. `draft_lesson_synthesis` — input: a `lesson_candidate` row. Output: lesson body in the existing `lessons` shape.
3. `draft_doc_section` — input: `{doc_path, section_anchor, prompt}`. Output: markdown for that section.

All outputs land in a new `ai_draft_outputs` table as `status='ready_for_review'`. Operator approves → drafts get applied by existing flows (lesson promotion / a small "copy to clipboard" button for changelog and docs). **No auto-merge.**

## Data model

| Table | Purpose |
|---|---|
| `ai_jobs` | The queue. `id, kind, input_json, status (queued/claimed/done/failed/cancelled), claimed_by, claimed_at, heartbeat_at, attempts, max_retries=3, priority, created_by, requested_model, idempotency_key UNIQUE` |
| `ai_job_results` | One row per attempt. `job_id, output_text, output_json, model, tokens_in, tokens_out, latency_ms, error, created_at` |
| `ai_draft_outputs` | Reviewable surface. `job_id, kind, target_ref jsonb, body_md, status (ready/approved/rejected/applied), reviewed_by, reviewed_at` |
| `ai_workers` | Registered Ollama boxes. `name, model_tags[], last_seen_at, enabled, owner_user_id` |

RLS: operator-only for read/review. Workers authenticate with `x-awip-service-token` (existing pattern) — never user JWT.

Realtime on `ai_jobs` and `ai_draft_outputs` so the review UI updates live.

`reclaim_stale_ai_jobs()` mirrors the existing `reclaim_stale_night_jobs` — call it from `sentinel-tick`. Heartbeat > 5 min stale → reset to `queued`, increment `attempts`, terminal `auto_blocked` at `max_retries`.

## Edge functions (all wrapped with `withLogger`, contracts in `_shared/contracts/`)

| Function | Auth | Purpose |
|---|---|---|
| `ai-jobs-enqueue` | operator JWT | Create a job. Validates input per `kind` via zod contract. Idempotent on `idempotency_key`. |
| `ai-jobs-claim` | service token | Worker pulls next `queued` job for its `model_tags`. Sets `claimed_by`, `claimed_at`, `heartbeat_at`. Returns one job or 204. |
| `ai-jobs-heartbeat` | service token | Worker pings every 60s while running. Updates `heartbeat_at`. |
| `ai-jobs-complete` | service token | Worker posts result. Writes `ai_job_results`, marks job `done`, creates `ai_draft_outputs` row `ready_for_review`. |
| `ai-jobs-fail` | service token | Worker reports error. Increments `attempts`, requeues or marks `failed`. |

No edge function ever calls Ollama. Cloud → Box traffic = zero.

## Worker (runs on your laptop)

Tiny TS or Python script — about 100 lines. Loop:

```text
every 5s:
  job = POST /ai-jobs-claim {model_tags: ["llama3.1:8b","qwen2.5-coder:7b"]}
  if !job: continue
  spawn heartbeat() every 60s
  build prompt from job.kind + job.input_json
  call http://localhost:11434/api/chat with job.requested_model
  POST /ai-jobs-complete {job_id, output_text, model, tokens_*, latency_ms}
```

Config: `AWIP_SERVICE_TOKEN`, `AWIP_BASE_URL`, `OLLAMA_URL=http://localhost:11434`, `WORKER_NAME`. Lives outside the repo (your `~/awip-worker/`). I'll provide the script as a copy-paste artefact, not part of this build.

Survives laptop sleep: on wake, claim picks up wherever the queue is. Stale jobs get reclaimed by sentinel.

## Producer hooks (where jobs come from)

- **Manual button** on `/admin/lessons` ("Draft with local LLM") → `draft_lesson_synthesis`.
- **Manual button** on `/admin/ai-usage` or a small `/admin/ai-jobs` console → `draft_changelog_entry` for a date range.
- **Manual button** on doc pages later — not in slice 1.

No cron producer in slice 1. Want explicit operator triggering until trust is established.

## Review UI — `/admin/ai-jobs`

Two tabs: **Jobs** (queue health, last 50, retry/cancel) and **Drafts** (ready_for_review with diff-style preview, Approve/Reject). Approve on a lesson draft populates the existing lesson form; approve on a changelog draft copies to clipboard and links the entry.

## Observability

- `ai_jobs_stuck` sentinel check: any job `claimed > 10 min ago` with stale heartbeat.
- `ai_workers_offline` sentinel: enabled worker with `last_seen_at > 15 min ago` AND queue depth > 0.
- All worker calls land in `ai_usage_log` with `job='ollama-worker'`, `model=<llama3.1:8b>`, so existing credits/usage panels show local spend as $0 — useful "what we saved" view later.

## Why this won't make me dumber

- I still write every job's input contract and review every output kind before it can be enabled.
- Slice 1 produces *text for you to approve*, not code or schema. Worst case: you reject a draft.
- Adding a new job kind requires a new contract file + new producer button — both are my work, not the worker's.

## Files I'll touch when you say go

- Migration: `ai_jobs`, `ai_job_results`, `ai_draft_outputs`, `ai_workers`, `reclaim_stale_ai_jobs()`, RLS.
- `supabase/functions/_shared/contracts/ai-jobs.ts` (zod schemas per kind).
- 5 edge functions above.
- `supabase/functions/sentinel-tick/checks.ts` — 2 new checks.
- `src/pages/AdminAiJobs.tsx` + route.
- Buttons on `/admin/lessons` and `/admin/ai-usage`.
- `docs/ai-jobs-ollama.md`, `CHANGELOG.md`, `mem://features/ai-jobs-ollama.md`, `mem://index.md`.
- A standalone worker script delivered as `/mnt/documents/awip-ollama-worker.ts` (lives outside the repo on your box).

## Open questions before I build

None blocking. If you want me to skip the `/admin/ai-jobs` page in slice 1 and just expose Approve/Reject inline on lessons + a tiny strip on `/admin/ai-usage`, say so — saves about a third of the UI work.
