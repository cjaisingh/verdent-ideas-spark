# AWIP Operational Maturity — Six Workstream Plan

Closes the loops the current ecosystem leaves open: backlog rot, observation glut without synthesis, reactive-only monitoring, doc drift, ungoverned ops actions, and missing CI signal.

Owner roles below are roles, not people. **Operator** = you (final authority on apply/dismiss). **Lovable agent** = me (implementation, scaffolding, drafts). **Cron** = automated.

---

## Workstream 1 — Morning Review (daily backlog hygiene)

**Goal:** No `discussion_actions` row sits in `in_progress` for more than 7 days unseen. Promotion-vs-shipping mismatch is surfaced every morning.

**Deliverables**
- `morning_reviews` table (operator-only RLS, realtime).
- Edge function `morning-review` (`GET ?days=7`).
- Cron `scheduled-morning-review` 06:00 UTC.
- Page `/morning-review`: KPI strip, Stuck Jobs, Promotion Drift, Night-Agent throughput, Cron heartbeat, Open findings, Top actions, Acknowledge button.
- Mirror-task-status one-click action (closes JOB-1/JOB-2 class bug).
- `docs/morning-review.md`, `mem://features/morning-review.md`.

**Owner:** Lovable agent builds; Operator acknowledges daily.

---

## Workstream 2 — Lessons-Learned Loop + Deferrals Registry (weekly synthesis → durable rules; nothing parked forever)

**Goal:** Recurring observations become rules instead of repeating noise. Every "out of scope for now" decision is tracked with a `defer_until` date and resurfaced for review — no item gets parked indefinitely.

**Deliverables — Lessons**
- `lessons` table (`category`, `severity`, `evidence jsonb`, `recommendation`, `status`, `applied_as`, `dedupe_key`).
- `lesson_events` table (status transitions, actor, payload).
- Edge function `lessons-synthesize` (clusters last 7 days from `night_observations`, `roadmap_review_findings`, `automation_runs`, `discussion_action_events`; uses `pickModel()` so overnight runs hit `gemini-2.5-flash-lite`).
- Cron `scheduled-lessons-weekly` Sunday 05:00 UTC.
- One-shot **14-day backfill button** on `/lessons` (operator-only, idempotent via `dedupe_key`, ~$0.03 estimated cost; disabled after first successful run via `lessons_backfill_runs` table).
- Page `/lessons`: cards per lesson, evidence chips (deep-link), Apply / Defer / Reject / Reopen. Apply writes a `mem://` entry or files a roadmap finding. Defer opens the deferral dialog (see below).
- Stub `Watchers` column on lesson cards (renders empty until W3 / Sentinel ships, no functional dependency).

**Deliverables — Deferrals Registry**
- `deferred_items` table (operator-only RLS, realtime): `title`, `reason`, `originating_context jsonb` (chat msg id / plan section / lesson id / finding id), `defer_until date NOT NULL DEFAULT now()+90d`, `severity`, `status` (`deferred` | `revisit_now` | `accepted` | `rejected`), `revisited_at`. Trigger enforces `defer_until > created_at`.
- Two ingestion paths: (1) "Defer" action on `/lessons` writes here in addition to flipping lesson status; (2) one-shot seed migration loads current `.lovable/plan.md` "Out of scope" list + auto-apply-high-sev-lessons + any chat-thread deferrals.
- Cron `scheduled-deferred-review` Mondays 06:15 UTC: flips rows whose `defer_until <= today` to `revisit_now`.
- Surface on `/morning-review` as a "Revisit this week" card; badge count on `/lessons` and on the sidebar `/morning-review` link.

**Cross-links**
- "Applied lessons this week" + "Items to revisit" sections on `/morning-review`.
- `docs/lessons-loop.md`, `docs/deferrals.md`, `mem://features/lessons-loop.md`.

**Owner:** Lovable agent drafts lessons + seeds deferrals; Operator applies / defers / rejects / revisits.

**Out of scope (deferred into the registry on first run):**
- Auto-applying high-severity lessons (operator-gated by design; revisit when Sentinel watcher precision is measurable).
- 90-day historical lesson backfill (14-day backfill is shipped instead; revisit if value of older signal proven).

---

## Workstream 3 — Periodic Deep Audit (weekly + monthly, 5 dimensions)

**Goal:** Quantified score across security, ISO27001 readiness, performance, roadmap adherence, resilience. Trend over time.

**Deliverables**
- `deep_audit_runs` table (`scope`, `dimension_scores jsonb`, `findings jsonb`, `overall_score`).
- Edge function `deep-audit` with sub-modules: `security.ts`, `iso27001.ts`, `performance.ts`, `roadmap.ts`, `resilience.ts`.
- Crons: weekly Sunday 04:00 UTC, monthly 1st 04:30 UTC.
- Page `/audits`: score chips, dimension accordions, ISO27001 control matrix, sparkline trend, "Promote to lesson/finding" buttons.
- High-severity findings auto-file into `roadmap_review_findings` AND draft a `lessons` row.
- Score-drop > 10 pts week-over-week → alert via `_shared/alerts.ts`.
- `docs/deep-audit.md`, `docs/iso27001-controls.md`, `mem://features/deep-audit.md`.

**Owner:** Cron generates; Operator reviews weekly, signs off monthly.

---

## Cost Tracking (cross-cutting, slotted between W2 and W4)

**Goal:** Estimated vs actual AI/automation spend per workstream so silent budget drift surfaces immediately, not in the monthly bill.

**Deliverables**
- `cost_estimates` table (workstream/task → kind monthly|oneshot, estimated_usd, model, job, notes; operator-only RLS, realtime).
- `cost_actuals_30d` view: rolls up `automation_runs.detail.cost_usd` per job over 30d.
- `cost_summary_by_workstream` view: joins estimates ⇄ actuals via the `job` link.
- `_shared/cost.ts` (deno) helper: `costDetail(model, usage)` produces the standard `{model, prompt_tokens, completion_tokens, cost_usd}` payload to merge into `automation_runs.detail`. Adopt incrementally as we touch each AI-calling function.
- `/plan` UI: per-workstream "Est $X/mo · one-shot $Y · Actual $Z (30d)" row + global KPI strip; red `over budget` badge when actual > 1.5× estimate.
- Seeded with the six workstream estimates (W1/W3/W5/W6: $0; W2 lessons: $0.70/mo + $0.03 one-shot backfill; deep-audit: ~$2.50/mo).

**Owner:** Lovable agent builds + maintains estimates as scope changes; Operator watches `/plan` for overrun badges.

---

## Workstream 4 — Logger Agent (structured edge logging + retention)

**Goal:** Every edge function emits structured logs with a request-id. Frontend errors are captured. Retention policies are explicit.

**Deliverables**
- `_shared/logger.ts` middleware: wraps every function handler, injects `x-request-id`, logs `{request_id, function, user_id_hash, status, latency_ms, classified_error}` to a new `edge_request_logs` table.
- Refactor existing functions to use the middleware (incremental — start with `awip-api`, `overnight-phase-runner`, alerts dispatcher).
- `_shared/frontend-error-capture.ts` + `<ErrorBoundary>` at app root → POSTs to a thin `frontend-errors` edge function → `frontend_error_logs` table.
- Retention: nightly `retention-sweep` cron deletes `edge_request_logs > 30d`, `frontend_error_logs > 30d`, `automation_runs > 30d` (configurable per table in a `retention_policy` table — already partially exists, formalise).
- `docs/logging.md`, `mem://features/logging.md`.

**Owner:** Lovable agent builds; no per-day operator action.

---

## Workstream 5 — Sentinel Agent (continuous 15-min watcher)

**Goal:** Catch silent failures (cron stopped, 5xx spike, RLS denial spike, secret rotation overdue) between the per-job alerts and the daily Morning Review.

**Deliverables**
- Edge function `sentinel-tick` running every 15 min via cron.
- Watchers (each one ~10 lines, easy to add more):
  - **Cron silence**: each known cron job must have a row in its tracking table within its expected window, else open a `sentinel_findings` row + dispatch alert.
  - **Edge 5xx rate**: pulls `function_edge_logs` last 15 min; > N% errors per function → alert.
  - **RLS denial spike**: postgres logs grep for `permission denied` over baseline.
  - **Secret rotation overdue**: `AWIP_SERVICE_TOKEN` rotated > 90d ago → warn; > 180d → alert.
  - **Unknown role grants**: any `role_change_audit` insert in last 15m by a non-admin actor.
- `sentinel_findings` table (operator-only RLS, realtime); rolled into Morning Review and Deep Audit.
- Page section on `/automation`: live Sentinel status strip.
- `docs/sentinel.md`, `mem://features/sentinel.md`.

**Owner:** Cron; Operator triages findings as they appear.

---

## Workstream 6 — Doc-Drift Agent + GitHub hardening

**Goal:** Code shipped without docs/changelog/memory entry is auto-flagged. CI gives independent signal.

**Deliverables — Doc-Drift**
- Edge function `doc-drift-scan` (weekly, Saturday 03:00 UTC):
  - Diffs git log of last 7 days vs `docs/`, `CHANGELOG.md`, `mem://features/`, `roadmap_tasks` history.
  - For each new edge function or migration without a matching doc, drafts a `lessons` row category=`process` with one-click "Scaffold doc" action that creates the file with TODO sections.
- Surfaces in `/lessons` and Morning Review.

**Deliverables — GitHub hardening (one-time, then maintained)**
- `.github/workflows/`:
  - `codeql.yml` — security scan on PR + weekly.
  - `dependabot.yml` — weekly npm + GitHub Actions updates.
  - `gitleaks.yml` — secret scanning on every push.
  - `lighthouse.yml` — perf budget on PR (LCP, TBT, bundle size).
  - `axe.yml` — accessibility check on PR.
  - `lint-and-typecheck.yml` — required check on PR.
- Branch protection: `main` requires PR + passing required checks. (Operator action in GitHub UI; doc the steps.)
- `docs/ci-cd.md`, `mem://preferences/ci.md`.

**Owner:** Lovable agent scaffolds workflows; Operator enables branch protection and reviews CI failures as they appear.

---

## Cross-cutting plumbing (built once, used by all six)

- `_shared/alerts.ts` — already exists, extend to take `{source, severity, dedupe_key}` so Sentinel and Deep Audit don't double-alert.
- `_shared/model-policy.ts` — already exists; all AI calls in synthesis/audit go through `pickModel()` so night runs stay cheap.
- `_shared/idempotency.ts` — already pattern; new tables get `(date_window, content_hash)` unique indexes where applicable.
- New roles: none — all surfaces are `has_role('operator')` read, `has_role('admin')` apply.
- Realtime: enabled on `morning_reviews`, `lessons`, `deep_audit_runs`, `sentinel_findings`, `edge_request_logs`, `frontend_error_logs`.

---

## Execution timeline (6 weeks, sequenced for compounding value)

```text
Week 1  ── WS4 Logger (foundation: everything else benefits from request-ids)
            • _shared/logger.ts + edge_request_logs + retention table
            • Wrap awip-api, overnight-phase-runner, alerts dispatcher
            • Frontend ErrorBoundary + frontend_error_logs

Week 2  ── WS1 Morning Review (daily value from day 8)
            • morning_reviews table + edge fn + cron
            • /morning-review page with all 7 sections
            • Mirror-task-status one-click

Week 3  ── WS5 Sentinel (closes silent-failure gap)
            • sentinel-tick cron + sentinel_findings table
            • Cron-silence + 5xx-rate + secret-age + role-grant watchers
            • Surface on /automation and Morning Review

Week 4  ── WS2 Lessons Loop (turns the now-richer signal into rules)
            • lessons table + lessons-synthesize fn + weekly cron
            • /lessons page with Apply/Defer/Reject
            • Cross-link from Morning Review

Week 5  ── WS3 Deep Audit (weekly + monthly assurance)
            • deep_audit_runs + 5 sub-modules + 2 crons
            • /audits page + ISO27001 matrix
            • Auto-promote high-sev to lessons/findings

Week 6  ── WS6 Doc-Drift + GitHub hardening (governance)
            • doc-drift-scan weekly cron
            • 6 GitHub Actions workflows
            • Branch protection enabled
            • README + CHANGELOG + mem index updates for everything

Ongoing ── Daily Morning Review ack (5 min), weekly Lessons triage (15 min),
            monthly Deep Audit signoff (30 min).
```

Each week is shippable on its own — if priorities change, stopping after any week leaves working value, not a half-built scaffold.

---

## Out of scope (queued, not in this plan)

- Auto-closing stale jobs (Morning Review surfaces only).
- External SIEM export of ISO27001 evidence.
- Frontend perf instrumentation beyond Lighthouse CI (no RUM yet).
- LLM-driven auto-application of lessons (always proposes, human applies).
- Human external security review — defer until customer data is in scope; budget line noted.
- Server-side uniqueness on `(phase_id, scheduled_for)` for overnight runs (separate small change).

---

## Acceptance per workstream

- **WS1**: 7 consecutive days with morning review acknowledged; at least one stuck job resolved via mirror action.
- **WS2**: at least 3 lessons applied (= memory entry written or finding filed).
- **WS3**: 4 weekly audits + 1 monthly audit complete; trend visible.
- **WS4**: 100% of edge functions wrapped; one frontend error captured end-to-end.
- **WS5**: at least one true-positive Sentinel finding caught before Morning Review surfaced it.
- **WS6**: PR with failing CodeQL/Lighthouse/axe blocked from merge; doc-drift caught one undocumented edge function.

---

## Files (high level)

- New tables (5 migrations): `morning_reviews`, `lessons`, `deep_audit_runs`, `sentinel_findings`, `edge_request_logs` + `frontend_error_logs` + `retention_policy` formalisation.
- New edge functions: `morning-review`, `scheduled-morning-review`, `lessons-synthesize`, `scheduled-lessons-weekly`, `deep-audit` (+ 5 modules), `scheduled-deep-audit-weekly`, `scheduled-deep-audit-monthly`, `sentinel-tick`, `frontend-errors`, `doc-drift-scan`, `retention-sweep`.
- New shared: `_shared/logger.ts`, `_shared/frontend-error-capture.ts`, alerts dedupe extension.
- New pages: `/morning-review`, `/lessons` (or extension), `/audits`. Sentinel strip added to `/automation`.
- New CI: 6 workflows under `.github/workflows/`.
- New docs: `morning-review.md`, `lessons-loop.md`, `deep-audit.md`, `iso27001-controls.md`, `logging.md`, `sentinel.md`, `ci-cd.md`. Updates to `README.md`, `CHANGELOG.md`, `mem://index.md`.
