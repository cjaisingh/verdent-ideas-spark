# AI Jobs — local Ollama worker

How to run AWIP Core's outsource queue against a local Ollama box. Slice 1
covers **doc / changelog / lesson drafting** — no code generation, no auto-merge.

- **Architect / planner / reviewer:** Lovable (in the build loop).
- **Worker:** stateless Node script on your machine, polls Cloud, runs Ollama.
- **Queue + audit:** Lovable Cloud (`ai_jobs`, `ai_job_results`,
  `ai_draft_outputs`, `ai_workers`).
- **Review surface:** [`/admin/ai-jobs`](/admin/ai-jobs).

Cloud never connects to your laptop. Worker is pull-only — no tunnels, no
inbound ports.

## Architecture

```text
operator ─► /admin/lessons , /admin/ai-usage
             │   (producer buttons → EnqueueDraftDialog)
             ▼
       ai-jobs-enqueue (operator JWT, idempotency key)
             │
             ▼
    ┌────────────────────┐         reclaim_stale_ai_jobs()
    │   ai_jobs (queue)  │ ◄──── called every 15 min by
    └────────┬───────────┘         sentinel-tick
             │
   ┌─────────┴──────────┐
   │ this worker (Node) │ polls every 5s with x-service-token
   └─────────┬──────────┘
             │
   ai-jobs-claim → ai-jobs-heartbeat (20s) → Ollama /api/chat
             │
             ▼
   ai-jobs-complete → ai_draft_outputs (status=ready_for_review)
             │
             ▼
        /admin/ai-jobs → operator Approve / Reject
```

Job kinds (all defined in
[`supabase/functions/_shared/contracts/ai-jobs.ts`](../supabase/functions/_shared/contracts/ai-jobs.ts)):

| Kind                      | Producer surface           | Draft target                |
|---------------------------|----------------------------|-----------------------------|
| `draft_changelog_entry`   | `/admin/ai-usage` header   | `CHANGELOG.md` block        |
| `draft_lesson_synthesis`  | `/admin/lessons` (header + per-card) | `lessons` row body |
| `draft_doc_section`       | `/admin/ai-usage` header   | named doc section           |

## Setup

### 1. Prerequisites

- Node.js 18+ on the worker box (uses global `fetch`).
- [Ollama](https://ollama.com/) running locally: `ollama serve`.
- At least one model pulled, e.g. `ollama pull llama3.1:8b`.
- The cross-project `AWIP_SERVICE_TOKEN` value (already in Cloud secrets).

### 2. Download the worker artefact

Three files, delivered by Lovable as artefacts and also archived in
`/mnt/documents/ollama-worker/`:

```
ollama-worker/
├── worker.mjs       # ~150 lines, zero npm deps
├── README.md
└── .env.example
```

Drop them on the worker box, e.g. `~/awip/ollama-worker/`.

### 3. Configure environment

```bash
cd ~/awip/ollama-worker
cp .env.example .env
# edit .env with the values below
```

Required:

| Var                  | Example                                       | Notes                                  |
|----------------------|-----------------------------------------------|----------------------------------------|
| `SUPABASE_URL`       | `https://agzkyzyzopcgeobofjaz.supabase.co`    | Cloud project URL                      |
| `AWIP_SERVICE_TOKEN` | `awip_…`                                      | Same token Cloud stores; never share   |
| `WORKER_NAME`        | `macbook-ollama-01`                           | Stable; used as upsert key             |
| `MODEL_TAGS`         | `llama3.1:8b,qwen2.5-coder:7b`                | Comma-separated; matched against job's `required_model_tags` |

Optional (defaults shown):

| Var             | Default                  | Purpose                                  |
|-----------------|--------------------------|------------------------------------------|
| `OLLAMA_URL`    | `http://localhost:11434` | Where to reach the Ollama daemon         |
| `DEFAULT_MODEL` | `llama3.1:8b`            | Used when job has no `requested_model`   |
| `POLL_MS`       | `5000`                   | Idle poll cadence                        |
| `HEARTBEAT_MS`  | `20000`                  | Heartbeat cadence while a job runs       |
| `MAX_JOB_MS`    | `300000`                 | Per-job timeout (5 min)                  |

### 4. Run

```bash
node --env-file=.env worker.mjs
```

Expected first lines:

```
… [worker] worker "macbook-ollama-01" tags=llama3.1:8b → https://…supabase.co
… [worker] ollama=http://localhost:11434 default_model=llama3.1:8b
… [worker] ollama ok, 3 models available
… [worker] idle (no jobs, 60s)
```

The worker auto-registers itself in `ai_workers` on the first claim, with
`enabled=true`. You can see it under
[`/admin/ai-jobs` → Workers](/admin/ai-jobs).

### 5. Keep it running

macOS: see `launchd` plist in `ollama-worker/README.md`.
Linux: a `systemd --user` unit with `Restart=always` works the same way.
Survives laptop sleep — stale claims get reclaimed by `sentinel-tick` after
~10 min of no heartbeat, so worst case a job restarts on next wake.

## Operator workflow

1. Click **Draft with local LLM** on `/admin/lessons` or **Draft changelog /
   Draft doc section** on `/admin/ai-usage`.
2. Fill the form. The producer calls `ai-jobs-enqueue` with an idempotency
   key; resubmitting the same form returns the same job.
3. Job appears on `/admin/ai-jobs` → **Jobs** tab. Once the worker claims it,
   status flips to `claimed`, then a draft lands under the **Drafts** tab as
   `ready_for_review`.
4. Click the draft → review markdown → **Approve** or **Reject** (with optional
   note). Approval does **not** auto-apply: copy the body into
   `CHANGELOG.md` / the doc / the lesson and commit.

## Cost & observability

- Every completion writes one `ai_usage_log` row with `job='ollama-worker'`,
  `cost_usd=0`. Visible on `/admin/ai-usage` and in the Credits tab.
- Two sentinel checks watch the pipeline (`sentinel-tick/checks.ts`):
  - **`ai_jobs_stuck`** — any job `claimed` with no heartbeat for >10 min.
  - **`ai_workers_offline`** — registered worker missing for >15 min while the
    queue is non-empty.
- `reclaim_stale_ai_jobs()` re-queues stuck jobs (respecting `max_retries`)
  and drives them to `auto_blocked` once retries are exhausted.

## Runbook — troubleshooting

### Worker won't start

| Symptom                                    | Cause / fix                                                                 |
|--------------------------------------------|------------------------------------------------------------------------------|
| `missing env: SUPABASE_URL`                | `.env` not loaded. Use `node --env-file=.env worker.mjs`.                    |
| `fatal: fetch failed` on launch            | DNS/proxy blocking `*.supabase.co`. Test with `curl $SUPABASE_URL`.          |
| Process exits immediately, no log          | Node <18. Upgrade (`node -v` ≥ 18).                                          |

### Worker runs but no jobs flow

| Symptom                                          | Cause / fix                                                              |
|--------------------------------------------------|---------------------------------------------------------------------------|
| `claim 401: unauthorized`                        | `AWIP_SERVICE_TOKEN` mismatch. Re-copy from Cloud secrets.                |
| `claim 403: worker_disabled`                     | Toggle worker on at `/admin/ai-jobs` → Workers.                           |
| Always idle, queue has jobs                      | Job's `required_model_tags` not a subset of `MODEL_TAGS`. Pull the model or extend `MODEL_TAGS`. |
| Worker not visible on `/admin/ai-jobs → Workers` | Worker has not made its first claim attempt — wait one `POLL_MS` tick.    |

### Jobs claimed but never complete

| Symptom                                          | Cause / fix                                                              |
|--------------------------------------------------|---------------------------------------------------------------------------|
| `ollama 404 model "X" not found`                 | `ollama pull X` on the worker box.                                        |
| `ollama 500` / timeout                           | Model too large for the box; switch `DEFAULT_MODEL` to something smaller. |
| Job stays `claimed`, no heartbeat                | Worker crashed. `sentinel-tick` reclaims after ~10 min; restart the worker. |
| `empty_output`                                   | Model returned nothing. Inspect prompt on `/admin/ai-jobs` → job detail; switch model or refine input. |

### Drafts never appear

| Symptom                                  | Cause / fix                                                            |
|------------------------------------------|-------------------------------------------------------------------------|
| Job is `done` but no draft row          | `projectDraft()` threw — check `ai-jobs-complete` logs in Edge Function Health. Usually a contract-input shape mismatch caused by hand-editing a job. |
| Draft is `ready_for_review` but blank   | Worker posted empty `output_text`. Re-enqueue with extra context.       |

### Cost surfaces look wrong

- `ai_usage_log` insert is **best-effort**; failures don't break the worker.
  If local rows are missing, check `/admin/edge-health` for `ai-jobs-complete`
  errors.
- Local rows always have `cost_usd=0` — they're for attribution, not billing.

### Hard reset

```sql
-- Cancel all queued + claimed jobs (operator-only RLS, run from /db-explorer):
update public.ai_jobs
   set status = 'auto_blocked', last_error = 'manual cancel'
 where status in ('queued','claimed');
```

The worker will go idle on next poll.

## Related

- Contracts: `supabase/functions/_shared/contracts/ai-jobs.ts`
- Edge functions: `ai-jobs-{enqueue,claim,heartbeat,complete,fail}`
- Sentinel checks: `supabase/functions/sentinel-tick/checks.ts`
  (`checkAiJobsStuck`, `checkAiWorkersOffline`)
- Memory: [`mem://features/ai-jobs-ollama`](../mem/features/ai-jobs-ollama.md)
- Review UI: [`/admin/ai-jobs`](/admin/ai-jobs)
- Producer surfaces: [`/admin/lessons`](/admin/lessons),
  [`/admin/ai-usage`](/admin/ai-usage)
