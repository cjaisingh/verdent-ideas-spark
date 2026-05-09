# W2 → W3 → W4: complete sequentially

Scope confirmed from `plan_tasks` (17 items). I'll ship each workstream end-to-end, mark its sub-tasks done, then move to the next. Each workstream gets at minimum one Deno unit-test file covering the core logic.

Conventions reused from W1 / existing functions:
- Service-token cron auth (`AWIP_SERVICE_TOKEN` via `x-service-token`) OR operator JWT.
- `withLogger` wrapper, `automation_runs` insert per run, `dispatchAlert` on error/anomaly.
- Night-window model selection via `pickModel()`.
- Idempotency via natural key (date / window).
- Tables: operator-only RLS, realtime enabled, no client writes.

---

## W2 — Morning Review (table already exists)

1. **Edge function `morning-review`** (`supabase/functions/morning-review/index.ts`)
   - Computes for `today` UTC: KPIs (24h automation success rate, last cron times per job, AI cost 24h), stuck jobs (cron silent >2× cadence), promotion-vs-shipping drift (open `discussion_actions` promoted but linked roadmap task not done after 72h), overnight throughput (`night_shifts` last night counts), open findings (`roadmap_review_findings` severity ≥ high open), top 5 actions (open `discussion_actions` priority desc), revisit items (`deferred_items` defer_until ≤ today).
   - Upserts into `morning_reviews` keyed on `review_date`.
   - Writes `automation_runs` row; alerts on failure.

2. **Cron `scheduled-morning-review`** — wrapper that posts to `morning-review`. Cron schedule registered via migration (`pg_cron`) at 06:00 UTC daily.

3. **Page `/morning-review`** — operator console showing latest review, KPI tiles, sections (stuck jobs, drift, throughput, findings, top actions, revisit). "Acknowledge" button (admins). "Mirror as discussion_action" one-click on each top-action / revisit (POSTs to `awip-api` or direct insert).

4. **Tests** — `morning-review/aggregator_test.ts`: pure aggregator helper (extracted from index.ts) tested against stub data covering: empty state, stuck-job detection, drift threshold, top-actions ordering.

5. **Docs** — `docs/morning-review.md` + memory entry under `mem://features/morning-review`.

---

## W3 — Sentinel Agent

1. **Migration**
   - `sentinel_findings (id, kind, severity, subject_ref jsonb, summary, payload, status, dedupe_key unique, first_seen_at, last_seen_at, resolved_at)`. Operator-read RLS, realtime.

2. **Edge function `sentinel-tick`** — runs every 15 min:
   - Cron silence: any `automation_runs.job` whose latest row is older than 2× expected cadence → finding.
   - 5xx spike: count `edge_request_logs` status >= 500 in last 15 min ≥ N → finding.
   - Secret age: rows in `app_secrets` updated_at > 90 days → low-sev finding.
   - Role grants: new `role_change_audit` rows in last 15 min granting admin → high-sev finding.
   - Dedupe via `dedupe_key`; `last_seen_at` bumped on repeat. Resolved when underlying check passes.
   - Records `automation_runs`, dispatches alert for new high/critical findings.

3. **Cron `scheduled-sentinel-tick`** — every 15 min via pg_cron migration.

4. **`SentinelStatusStrip`** added to `/automation` page: green/amber/red pill, count of open findings by severity, last tick time, latest 3 findings.

5. **Roll into Morning Review** — `morning-review` aggregator pulls open `sentinel_findings` severity ≥ medium into the `open_findings` array (alongside roadmap_review_findings).

6. **Tests** — `sentinel-tick/checks_test.ts`: each check returns expected finding payload from stub data; dedupe behaviour verified.

7. **Docs** — `docs/sentinel.md` + `mem://features/sentinel`.

---

## W4 — Lessons-Learned Loop (table already exists)

1. **Edge function `lessons-synthesize`**
   - Window: last 7 days. Inputs: `roadmap_review_findings`, `sentinel_findings`, `qa_checks` failures, `automation_runs` errors, `night_proposals`.
   - Calls Lovable AI Gateway (model via `pickModel`) with structured-output JSON: array of `{category, severity, title, recommendation, evidence[]}`.
   - Upserts into `lessons` via `dedupe_key = sha1(category|title)`; status=`proposed`.
   - Records `automation_runs`, `lessons_backfill_runs`-style row not needed (use existing automation_runs only).

2. **Cron `scheduled-lessons-weekly`** — Sunday 05:00 UTC via pg_cron migration.

3. **Page `/lessons`** — list proposed/applied/deferred/rejected lessons; filters by category & severity; admin actions: Apply / Defer / Reject (writes `lesson_events`). Cross-link button on each: "Open in Morning Review".

4. **Cross-link on `/morning-review`** — "Open lessons (N proposed)" header link.

5. **Tests** — `lessons-synthesize/dedupe_test.ts`: identical input twice → single row; `dedupe_key` stable; severity normalisation.

6. **Docs** — `docs/lessons-loop.md` + `mem://features/lessons-loop`.

---

## Execution order

1. W2 migration (cron only — table exists) → function → page → tests → mark sub-tasks done.
2. W3 migration (table + cron) → function → UI strip → roll into W2 aggregator → tests → done.
3. W4 cron migration → function → page → cross-link → tests → done.
4. Final: update `mem://index.md` Memories section; one summary message.

## Out of scope (call out, don't ship)

- Streaming/realtime panels beyond what already exists.
- AI-generated copy review for `morning-review` itself (deterministic aggregation only — keeps cost ~$0/run).
- Migrating existing `lessons-backfill` flow into W4 (kept independent).

Estimated new files: ~14 (3 functions, 3 tests, 3 pages, 3 docs, 2 migrations). Estimated edited files: ~5 (App.tsx routing, Plan/Automation panels, mem index).
