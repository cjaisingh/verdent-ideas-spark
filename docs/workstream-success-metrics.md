# Workstream Success Metrics & Acceptance Criteria

Objective, measurable definitions of "done" and "healthy" for each of the six operational-maturity workstreams. Every workstream has:

- **Acceptance criteria** — binary checks that must pass to call the workstream "shipped".
- **Success metrics (KPIs)** — ongoing numbers that prove the workstream is delivering value, with explicit targets and the source query/table.
- **Health SLOs** — thresholds that, when breached, raise a Sentinel finding.

Targets are reviewed quarterly. All metrics are queryable from Lovable Cloud (`supabase--read_query`) so the Morning Review and Plan dashboards can render them without bespoke wiring.

---

## WS1 — Morning Review

**Goal:** every morning the operator sees one page that explains the state of the system and the top three actions for the day, and acknowledges it.

### Acceptance criteria
1. `morning_reviews` table exists with operator-only RLS and a unique index on `(review_date)`.
2. `morning-review` edge function runs daily at 06:00 UTC via cron, idempotent on `review_date`.
3. `/morning-review` page renders KPI strip, Stuck Jobs, Promotion Drift, Night-Agent throughput, Open findings, Top 3 actions.
4. Operator can acknowledge with a single click; ack writes `acknowledged_at` + `acknowledged_by`.
5. Page link surfaces an unread badge in the sidebar until acknowledged.

### Success metrics
| KPI | Target | Source |
|---|---|---|
| Daily generation success rate | ≥ 99% (≤ 1 miss / 100 days) | `select count(*) from morning_reviews where created_at::date = current_date` |
| Operator ack rate | ≥ 95% within 24h | `acknowledged_at - created_at` p95 ≤ 24h |
| Top-action follow-through | ≥ 70% promoted to roadmap or closed within 7 days | join `morning_reviews.top_actions` → `roadmap_tasks` / `discussion_actions` |
| Time-to-first-action | p50 ≤ 10 min after ack | derived from `discussion_action_events` |

### Health SLOs
- Cron silence > 30h after expected 06:00 UTC tick → Sentinel `cron-silence`.
- Generation latency p95 > 30s → Sentinel `slow-job`.

---

## WS2 — Lessons-Learned Loop

**Goal:** signals from night runs, audits, and findings are weekly clustered into reusable rules and applied to the system.

### Acceptance criteria
1. `lessons` table with `category`, `severity`, `evidence jsonb`, `recommendation`, `status`, `applied_as`.
2. `lessons-synthesize` edge function clusters last 7 days from `night_observations`, `roadmap_review_findings`, `automation_runs`, `discussion_action_events`.
3. Weekly cron Sundays 05:00 UTC.
4. `/lessons` page with Apply / Defer / Reject actions; status transitions write to `lesson_events`.
5. Cross-link from Morning Review → relevant lesson when KPI breach maps to an open lesson.

### Success metrics
| KPI | Target | Source |
|---|---|---|
| Lessons synthesized per week | 3–10 (too few = under-clustering, too many = noise) | `count(*) from lessons where created_at > now()-interval '7 days'` |
| Application rate | ≥ 60% of `proposed` lessons reach `applied` within 14 days | `applied_at - created_at` |
| Recurrence rate | ≤ 10% of applied lessons re-trigger the same evidence pattern within 30 days | join `lessons.evidence` ↔ later `night_observations` |
| Median severity of open backlog | ≤ "medium" | `lessons where status='proposed'` |

### Health SLOs
- Zero lessons synthesized for 2 consecutive weeks → Sentinel `synthesis-silence`.
- Open `proposed` backlog > 25 → Sentinel `lesson-backlog`.

---

## WS3 — Periodic Deep Audit

**Goal:** weekly + monthly automated audits across 5 dimensions, with high-severity findings auto-promoted.

### Acceptance criteria
1. `deep_audit_runs` table with `dimension`, `score`, `findings jsonb`, `run_kind` ('weekly'|'monthly').
2. Five sub-module edge functions: `audit-security`, `audit-iso27001`, `audit-performance`, `audit-roadmap`, `audit-resilience`.
3. Two crons: Sundays 04:00 UTC (weekly), 1st of month 04:30 UTC (monthly full).
4. `/audits` page renders score chips per dimension, ISO27001 control matrix, 12-week sparkline.
5. Severity ≥ "high" auto-creates a `lessons` row and a `roadmap_review_findings` row.

### Success metrics
| KPI | Target | Source |
|---|---|---|
| Weekly run completeness | 5/5 dimensions complete every Sunday | `deep_audit_runs where run_kind='weekly'` group by week |
| Composite score trend | non-decreasing 4-week moving average | `avg(score) over (order by created_at rows 3 preceding)` |
| High-severity finding MTTR | p50 ≤ 14 days, p95 ≤ 30 days | `findings.resolved_at - findings.created_at` |
| ISO27001 control coverage | ≥ 90% of in-scope controls evaluated each month | matrix completeness |

### Health SLOs
- Any dimension fails to run for 2 consecutive weeks → Sentinel `audit-gap`.
- Composite score drops > 15 pts week-over-week → Sentinel `audit-regression`.

---

## WS4 — Logger Agent (already shipped W1)

**Goal:** every edge function and frontend error is structured, request-traceable, and queryable.

### Acceptance criteria
1. `_shared/logger.ts` `withLogger` wraps every edge function (target: 100% of `supabase/functions/*`).
2. Every response carries `x-request-id`.
3. `edge_request_logs` and `frontend_error_logs` tables exist with operator-only RLS + 30-day retention sweep.
4. `ErrorBoundary` mounted at app root; `frontend-error-capture` listens to `unhandledrejection` + global `error`.
5. `/admin/logs` page filters by function, status, request_id, classified_error.

### Success metrics
| KPI | Target | Source |
|---|---|---|
| Edge function coverage | 100% wrapped | grep `withLogger` across `supabase/functions` |
| Request-id propagation | 100% of responses carry `x-request-id` | sample via `edge_request_logs` |
| Classified-error rate | ≤ 2% of total requests (excluding `auth` 401s) | `count(*) filter (where classified_error not in ('none','auth')) / count(*)` |
| Frontend error rate | ≤ 0.5% of sessions | `frontend_error_logs` distinct sessions |
| Log ingest latency | p95 ≤ 2s from event to row | `created_at - event_ts` |

### Health SLOs
- Any function with > 5% 5xx over a 1-hour window → Sentinel `5xx-spike`.
- Log ingest stops for > 15 min during business hours → Sentinel `logger-silence`.

---

## WS5 — Sentinel Agent

**Goal:** silent failures stop being silent. Every 15 min, watchers detect anomalies and surface them.

### Acceptance criteria
1. `sentinel-tick` edge function runs every 15 min.
2. Watchers implemented: `cron-silence`, `5xx-rate`, `rls-denial-spike`, `secret-rotation-overdue`, `unknown-role-grant`.
3. `sentinel_findings` table with `watcher`, `severity`, `evidence`, `acknowledged_at`, `resolved_at`.
4. Findings render on `/automation` and inside Morning Review.
5. Each finding includes a deterministic `dedupe_key` so noisy watchers don't flood the table.

### Success metrics
| KPI | Target | Source |
|---|---|---|
| Detection lead time | p95 ≤ 30 min (2 ticks) from breach to finding | synthetic injection test |
| False-positive rate | ≤ 15% of findings marked `false_positive` on resolve | `sentinel_findings.resolution` |
| MTTA (acknowledge) | p50 ≤ 1h business hours, ≤ 8h overnight | `acknowledged_at - created_at` |
| MTTR (resolve) | p50 ≤ 24h for `high`+ | `resolved_at - created_at` |
| Tick reliability | ≥ 99% of expected 15-min ticks executed | `count(*) from edge_request_logs where function='sentinel-tick' group by 15-min bucket` |

### Health SLOs
- Two consecutive missed ticks → self-promote a `sentinel-down` finding via `morning-review` fallback.
- > 50 unresolved findings → Morning Review escalates to top-action.

---

## WS6 — Doc-Drift Agent + GitHub hardening

**Goal:** docs and CHANGELOG don't lag the code, and the GitHub repo enforces quality gates on every PR.

### Acceptance criteria
1. `doc-drift-scan` edge function runs Saturdays 03:00 UTC; diffs `git log` since last scan against `docs/`, `CHANGELOG.md`, `mem/`, `roadmap_tasks`.
2. Findings written to `doc_drift_findings` with file, commit_sha, suggested_section.
3. Six GitHub Actions workflows live and required: `codeql.yml`, `dependabot.yml`, `gitleaks.yml`, `lighthouse.yml`, `axe.yml`, `lint-and-typecheck.yml`.
4. Branch protection on `main`: require all 6 checks + 1 review + linear history.
5. `/docs-drift` panel (or section on Morning Review) lists open drift findings.

### Success metrics
| KPI | Target | Source |
|---|---|---|
| Doc-drift open backlog | ≤ 10 findings | `doc_drift_findings where resolved_at is null` |
| Median drift age at resolution | ≤ 7 days | `resolved_at - created_at` |
| CI green rate on `main` | ≥ 95% | GitHub Actions API |
| Lighthouse perf score | ≥ 85 mobile, ≥ 90 desktop | `lighthouse.yml` artifact |
| Axe violations per PR | 0 serious/critical | `axe.yml` artifact |
| Gitleaks findings | 0 on `main` | `gitleaks.yml` |
| Dependabot PR merge time | p50 ≤ 7 days for non-major | GitHub API |

### Health SLOs
- Doc-drift backlog > 20 → Sentinel `doc-drift-backlog`.
- Any required CI check disabled or removed → Sentinel `ci-guard-removed`.

---

## Cross-workstream rollup

A composite **Operational Maturity Index (OMI)** computed weekly, rendered on the Plan dashboard:

```text
OMI = 0.20 * WS1_health + 0.15 * WS2_health + 0.20 * WS3_health
    + 0.20 * WS4_health + 0.15 * WS5_health + 0.10 * WS6_health
```

Each `WSn_health` is the % of that workstream's KPIs hitting target over the trailing 4 weeks. Target: **OMI ≥ 0.85** by end of W6, **≥ 0.90** sustained from W8 onward.

A workstream is considered "shipped" when:
- 100% of its acceptance criteria pass, AND
- ≥ 80% of its KPIs hit target for 2 consecutive weeks after rollout.

Until both conditions hold, the workstream stays `in_progress` on the `/plan` dashboard regardless of code completion.
