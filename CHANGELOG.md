# Changelog

All notable changes to AWIP Core. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are when the change landed in the operator-facing build.

## [Unreleased]

_Nothing pending._

---

## [0.7.0] — 2026-05-06 — Operator observability & automation

### Added
- **Scheduled AI code review** — `scheduled-code-review` edge function (weekly `pg_cron`) summarises the last 7 days of git diff via Lovable AI Gateway (`google/gemini-2.5-pro`) into `roadmap_review_findings`. UI: click-to-expand findings with file/line context; filter by severity / acknowledged; sort by date or severity.
- **Nightly tests** — `.github/workflows/nightly.yml` runs vitest unit + e2e at 02:00 UTC and POSTs results to `record-test-run` → `test_runs`. UI: per-run list with status filter and last-run chip.
- **QA probes** — `qa-validate` edge function runs phase-success-criterion checks against `qa_checks`. UI: progress bar + per-check expand showing pass/fail criteria and last note.
- **Failure alerts** — `alert_settings` / `alert_log` tables and inline `dispatchAlert` helper wired into all three jobs. Configurable Slack/Discord/custom webhook with per-reason toggles (`alert_on_review_error`, `alert_on_high_finding`, `alert_on_test_fail`, `alert_on_qa_fail`), dedupe window, send-test button, and realtime delivery log in the Automation card.
- **Runbook page** — new `/runbook` route consolidates open high/medium findings, failed test runs, failing QA probes, and recent alert deliveries into a single triage view with one-click acknowledge.
- `docs/automation.md` — full reference for the four automation jobs, payload shape, Slack/Discord/custom-receiver setup, and operator workflow.
- README links to the automation doc and `/runbook` page.

---

## [0.6.0] — 2026-05-06 — Security documentation

### Added
- `docs/security.md` — full security reference: identities & roles, RLS policy matrix for every table, the `authorize()` flow in the edge function, service-token trust model between sibling Lovable projects (with rotation steps), idempotency as a replay defence, audit-log conventions, and a quarterly operator review checklist.
- README link to the new security doc alongside architecture, API, and development docs.

---

## [0.5.0] — 2026-05-06 — Local development guide

### Added
- `docs/development.md` — step-by-step local setup: Node/bun prerequisites, every required env var (frontend `VITE_*` and backend secrets), migration paths (Lovable agent vs local Supabase CLI) with the "never edit `types.ts`/`auth`/`storage`/etc." rules, edge-function deploy + `curl` invocation patterns, Vitest/Deno test commands, common workflows (add endpoint, add column, promote capability), and a troubleshooting section for the recurring 401 / stale-lock / `CHECK now()` issues.
- README link to the development guide.

---

## [0.4.0] — 2026-05-06 — Architecture overview

### Added
- `docs/architecture.md` — mental model ("Core is a substrate, not a brain"), the two halves of the data model (OKR tree + capability manifest), the two event streams (`okr_node_events`, `capability_events`) and how they merge in `GET /events/recent`, how the operator UI vs Control Plane consume the system, the four load-bearing invariants, and the project-boundary contract for Discovery AI / Control Plane / future module projects.

---

## [0.3.0] — 2026-05-06 — API reference

### Added
- `docs/api.md` — complete reference for all 9 `/awip-api` endpoints with request/response examples, query params, and error shapes. Documents the dual auth model (operator JWT vs `x-awip-service-token`), `Idempotency-Key` semantics (currently honoured on `POST /okr/ingest`), the `api_call_logs` schema written on every call, and quick recipes for browser calls, cross-project service calls, and event-feed polling.

---

## [0.2.0] — 2026-05-06 — Capability detail page

### Added
- `GET /capabilities/:id/demand-detail` endpoint — returns a capability with the active KRs and tenants driving its demand.
- `src/pages/CapabilityDetail.tsx` — operator UI page consuming the new endpoint, reachable from the Control Plane demand board.
- Route wired up in `src/App.tsx`; demand board rows now link into the detail page.

### Changed
- `.lovable/plan.md` and `README.md` updated to reflect the new endpoint and page.

---

## [0.1.0] — initial v1 surface

### Added
- **Database** (Lovable Cloud / Postgres + RLS on every table)
  - OKR side: `tenants`, `okr_nodes`, `okr_measurements`, `okr_node_events`
  - Capability side: `capabilities`, `capability_connectors`, `capability_events`
  - Cross-cutting: `idempotency_keys`, `api_call_logs`, `user_roles`
  - `has_role()` `SECURITY DEFINER` function and `bootstrap_first_operator()` trigger so the first signup auto-promotes to operator + admin.
- **Contract API** (`supabase/functions/awip-api/index.ts`)
  - `GET  /capabilities` — manifest, optional `?status=` filter
  - `POST /capabilities/register` — module self-registration (upsert + emit `registered`)
  - `POST /okr/ingest` — idempotent OKR-tree ingestion
  - `POST /okr/:id/spawn` — spawn a sub-OKR with mandatory `spawned_from_reason`
  - `POST /okr/:id/supersede` — replace a node, preserving history
  - `GET  /okr/tree?tenant_id=…` — full tree including superseded
  - `GET  /events/recent` — merged OKR + capability event stream (`limit`, `since`, `tenant_id`)
  - `GET  /capabilities/demand` — capabilities ranked by `active_kr_count` then `tenant_count`; surfaces `unknown` capabilities referenced by KRs but never registered
  - Dual auth: operator JWT or `x-awip-service-token`. Every call logged to `api_call_logs`.
- **Operator UI**
  - Tenants, Capabilities, Events, API logs pages
  - Control Plane: demand board + live event feed (5s polling)
  - Auth flow gated on `operator` / `admin` role in `user_roles`

### Design rules established
1. Every OKR mutation emits an `okr_node_events` row.
2. Every manifest change emits a `capability_events` row.
3. All write endpoints are idempotent — same `Idempotency-Key` returns the original response.
4. No "who acts when" logic in Core — routing belongs in the Control Plane.
