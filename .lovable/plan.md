## Night Shift expansion plan

### 1. What already runs at night (baseline)

So you can see what's *not* a gap before we add anything:

| Job | Cadence (UTC) | Category |
|---|---|---|
| `night-agent-open` / `-close` | 22:00 / 06:00 | Audit eligible discussion actions |
| `overnight-phase-runner-15m` | every 15 min in window | Phase briefings (observation only) |
| `overnight-prequeue` | 21:55 | Auto-queue opt-in phases |
| `app-walkthrough` | 02:15 | Route + capability self-test |
| `deep-audit` (weekly/monthly) | Sun 04:00 / 1st 04:30 | Secrets, RBAC, automation, RLS, retention |
| `retention-sweep` | 03:30 | Purge expired rows |
| `sentinel-tick` | every 15 min | 5xx spikes, cron silence, stale secrets |
| `lessons-synthesize` | weekly | AI synthesis into `lessons` |
| `morning-review` | 06:00 | Daily KPI snapshot |
| `awip-reviews-pull` | Mon 05:30 | Pull weekly external reviews |
| `quarterly-review-open` | quarterly | Open quarterly checklist action |
| Night model policy | always 22:00–06:00 | Forces all AI to `gemini-2.5-flash-lite` |

**Already covered from your list:** purging ✓, health checks ✓, audit trail ✓, weekly/daily reports ✓, AI synthesis ✓.

**Real gaps:** analytics rollups, external/contract data ingestion, snapshot reports, cache warming. (DB backups are handled by Lovable Cloud's managed snapshots; no project-level work needed. ML training is N/A — we don't host any trainable models.)

### 2. New nightly jobs (the actual proposal)

```text
22:00 ── night-agent-open ─────────────────────────────► (existing)
22:30 ── ingest-external-data       (NEW, gap #2)
23:00 ── nightly-rollup-analytics   (NEW, gap #1)
23:30 ── snapshot-daily-report      (NEW, gap #3)
00:00 ── cache-warm                 (NEW, gap #4)
02:15 ── app-walkthrough ──────────────────────────────► (existing)
03:30 ── retention-sweep ──────────────────────────────► (existing)
04:00 ── deep-audit (Sun) ─────────────────────────────► (existing)
05:30 ── awip-reviews-pull (Mon) ──────────────────────► (existing)
06:00 ── morning-review + night-agent-close ───────────► (existing)
```

#### NEW-1 · `nightly-rollup-analytics` (23:00 UTC daily)

Pre-compute the aggregations that `/admin/ai-usage`, `/admin/cron-health`, `/morning-review`, and the dashboard widgets currently calculate on every page load.

- New tables: `analytics_daily_ai_usage`, `analytics_daily_automation`, `analytics_daily_cost` (date + dims + counts/cost/p50/p95/error_rate). Operator-read RLS.
- Idempotent on `(date, dims)`; backfills last 7 days on each run so a missed night self-heals.
- Frontend widgets read the rollup table when present, fall back to live query for "today".

#### NEW-2 · `ingest-external-data` (22:30 UTC daily)

A generic, pluggable ingestor for the contract-context sources you mentioned. PR-1 ships the framework + one concrete source so we have an end-to-end path without overcommitting.

- New table `ingestion_sources` (source_key, kind, config jsonb, enabled, last_run_at, last_status).
- New table `ingestion_runs` (source_key, started_at, finished_at, rows_in, rows_upserted, status, error, idempotency_key).
- Edge function dispatches per-source by `kind` (start with `awip_docs_refresh` — re-runs `scripts/ingest-awip-docs.ts` server-side so the RAG corpus stays fresh nightly).
- New sources are added by inserting a row + a small handler in the function — no schema change per source.

#### NEW-3 · `snapshot-daily-report` (23:30 UTC daily)

A frozen, point-in-time daily snapshot you can read in the morning without recomputation, and that we can diff week-over-week.

- New table `daily_snapshots` (snapshot_date PK, kind, payload jsonb, summary text, ai_brief text). Operator-read RLS.
- Generates two kinds: `system` (run counts, error rate, AI spend, sentinel/audit findings, deferred items due) and `contract` (capability manifest deltas, OKR mutations in 24h, promotion-vs-shipping drift).
- AI brief uses `pickModel("google/gemini-2.5-flash")` → automatically falls back to `flash-lite` per night-cheap policy.
- Mirrors the snapshot date into `morning-review` so the 06:00 page links straight to it.

#### NEW-4 · `cache-warm` (00:00 UTC daily)

Pre-warm the heaviest read paths so morning load on `/companion`, `/dashboard`, `/roadmap`, `/audits` is instant.

- New table `cache_warm_runs` (route, started_at, ms, ok).
- Function calls a small list of public read RPCs (`list_managed_cron_jobs`, `retention_stats`, `awip_rag_search` with the top-N saved queries from `awip_rag_query_log` if it exists, else a static seed list).
- Pure side-effect job — populates Supabase's query plan cache and our edge-function module cache. No business data changes.

### 3. Operator surface

One new page `/night-shift` (admin only) listing **every** nightly job in a single table:

- columns: job, schedule, last status, last duration, next fire (computed from cron), category badge (audit / ingest / rollup / snapshot / hygiene), "Run now" button (admin only, calls the function with `x-awip-service-token`).
- Reuses the `list_managed_cron_jobs` pattern — extended via a new RPC `list_all_nightly_jobs()` that returns the full curated set, not just the W2/W3/W4 trio.
- Adds a "Night Shift" link in the sidebar under **Operations** (next to Automation and Audits).

### 4. Memory + docs

- New `mem://features/night-shift.md` — index of every nightly job, who reads its output, and which morning surface consumes it.
- Update `mem://index.md` Core line to mention the new jobs.
- New `docs/night-shift.md` — operator runbook (how to pause a job, how to re-run, where outputs land, how snapshots and rollups relate).
- Update `mem/preferences/review-cadence.md` with the new daily entries.
- `CHANGELOG.md` entry per PR.

### 5. Sequencing

Independent PRs so we can land them one at a time:

| PR | Scope | Effort |
|---|---|---|
| **PR-1** | `nightly-rollup-analytics` + tables + 3 widgets switched to read rollups | ~3h |
| **PR-2** | `snapshot-daily-report` + `/morning-review` link-through | ~2h |
| **PR-3** | `ingest-external-data` framework + `awip_docs_refresh` source | ~2h |
| **PR-4** | `cache-warm` + `/night-shift` page + sidebar link + `list_all_nightly_jobs` RPC | ~2h |

Each PR registers its cron via `supabase--insert` (per project rule — cron registration uses anon key + URL, not migration). Each new edge function ships with `withLogger`, `AWIP_SERVICE_TOKEN` auth, and an `automation_runs` row per execution so they show up automatically in `/admin/cron-health` and the sentinel watches them.

### 6. Out of scope (intentional)

- DB backups — handled by Lovable Cloud managed snapshots; no project work needed.
- ML training — no trainable models in the project today.
- Real-time / interactive jobs — by definition not night work.
- Removing or re-cadencing existing jobs — separate decision per the quarterly review.

### 7. Verification caveats (per `mem://preferences/verification-discipline`)

- I can verify cron registration via `supabase--read_query` against `cron.job` after each PR.
- I can verify each new function deploys and returns 200 via `supabase--curl_edge_functions`.
- I **cannot** verify that 22:00 UTC actually fires correctly until we observe a real `automation_runs` row the morning after — the first 24h after each PR is "unverified, awaiting first nightly run."
- No GitHub remote is connected, so I will not claim any of this is "in CI" or "deployed via workflow."

### 8. Decisions I need from you before PR-1

1. **Rollup retention** — keep `analytics_daily_*` rows indefinitely, or purge after 90/180/365 days? (I'd default 365, retention-sweep handles it.)
2. **Snapshot AI brief** — generate the AI summary every night (small recurring cost ~$0.001/night on flash-lite), or only on weekdays?
3. **Ingestion sources beyond `awip_docs_refresh`** — do you have a specific external contract-data source in mind for PR-3, or is the framework + one source enough for now and we add real sources as you name them?
4. **Order** — ship in the listed order (rollups → snapshot → ingest → cache+page), or do you want the `/night-shift` operator page first so you can watch the rest land?
