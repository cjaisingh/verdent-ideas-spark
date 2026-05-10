# Changelog

All notable changes to AWIP Core. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are when the change landed in the operator-facing build.

## [Unreleased]

### Added
- **Quarterly Review System** — new `quarterly-review-open` edge function + cron `scheduled-quarterly-review-open` (Jan/Apr/Jul/Oct 1 @ 09:00 UTC) opens an idempotent `discussion_action` per quarter linking to the new `docs/quarterly-review.md` checklist (scaffold configs, Tailwind drift, Dependabot majors, edge-function & cron inventory, mem:// sweep, ADRs, secrets rotation, sidebar IA, RLS coverage). Owner: operator, due 14 days. Memory: `mem://preferences/review-cadence` codifies the full per-PR/daily/weekly/quarterly map so future sessions stop guessing.

### Documented
- **Edge-function sweep — 10 May** — `docs/edge-function-sweep-2026-05-10.md` audits all 38 edge functions (caller counts: frontend / edge-to-edge / cron / docs / `withLogger` coverage). 34 keep, 3 need operator decision (`automation-auth-monitor`, `copilot-voice`, `roadmap-phase-signoff`), 3 missing `withLogger` (`companion-cloud-chat`, `companion-context`, `gemini-tts`). No deletions in this pass.
- **Scaffold-config audit — 10 May** — `docs/scaffold-config-audit-2026-05-10.md` reads `vite.config.ts`, `tsconfig.*`, `eslint.config.js`, `postcss.config.js` against the starter template. No actionable drift; deferred to next quarterly review when the operator can produce a fresh-template diff source.

### Documented
- **Plan execution — 10 May review** — landed CI-secrets-at-a-glance table + nightly POST verification snippet in `docs/ci-cd.md`; `mem/` secret scrub came back clean (`docs/mem-audit-2026-05-10.md`); migration naming convention + auto-generated chronological index (`docs/migrations.md`, `docs/migration-index.md`, `scripts/index-migrations.ts` — 86 migrations, 28 documented, 58 missing top-of-file summary); full `awip-rag` reference (`docs/awip-rag.md`) and 35-function inventory with cron/UI/server callers and two flagged candidates `copilot-noop-llm` + `telegram-send-voice` (`docs/edge-function-audit.md`); Phase 2 closeout report (`docs/phase-2-closeout.md`) — gate snapshot, 7-task triage, and a flagged drift between `roadmap_phases` in DB (phase-3 + phase-4 already `done`, phase-4 titled "Voice") and `docs/master-plan.md` (which still treats Phase 4 "OKR-Driven Execution" as planned). README docs index updated to surface the four new docs.

### Changed
- **Memory hygiene** — corrected the stale "GitHub repo connected" assumption in `mem://index.md` (no git provider is actually wired to this Lovable project yet). Added new `mem/preferences/verification-discipline.md` codifying what is / isn't verifiable from the sandbox and the required "unverified — please confirm" phrasing for git-sync, CI, deploy, and published-frontend state. Logged a `governance` lesson ("Verify external state before asserting it") in `public.lessons` so it surfaces on `/admin/lessons`.

### Added
- **Gemini TTS + Rork iPhone companion spec** — new `gemini-tts` edge function (`supabase/functions/gemini-tts/index.ts`) proxies Google AI Studio's Gemini 2.5 Flash TTS, returns `audio/wav` (24 kHz mono PCM, server-wrapped WAV header) for direct playback in `expo-av` and the browser. Operator-JWT only, 8 prebuilt voices (default `Kore`), every call logged to `ai_usage_log` with `job='gemini-tts'`. Browser preview at `/admin → Gemini TTS preview` (`src/components/admin/GeminiTtsTestPanel.tsx`). New secret `GOOGLE_AI_API_KEY` (direct Google AI Studio key — not via Lovable AI Gateway, since Gemini TTS isn't exposed there). Bypasses the 22:00–06:00 UTC night-cheap policy (reasoning-model only). Docs: `docs/gemini-tts.md`. The iPhone companion contract — voice capture, approvals inbox, morning + night digest, discussion actions, conversation mode with Gemini TTS online + `expo-speech` offline fallback, email/password auth, APNs push, Supabase JS direct — is documented in new `docs/rork-companion-spec.md`. Memory: `mem/features/gemini-tts.md`. Companion memory updated to flag Gemini TTS as the default voice for both surfaces.
- **Night-cheap models + overnight phase queue** — between 22:00 and 06:00 UTC every AI job now uses `google/gemini-2.5-flash-lite` via the new shared helper `supabase/functions/_shared/model-policy.ts → pickModel()`, wired into `daily-plan`, `scheduled-code-review`, `discussion-extract-actions`, and the new `overnight-phase-runner`. Each `ai_usage_log` row records `request_ref.night_mode` so the spend chart can attribute night savings. New table `roadmap_phase_overnight_runs` (operator-only RLS + realtime) lets operators click **Run overnight** on any signed-off phase row in `PhaseSignoffAudit`; the row is queued for the next 22:00–06:00 UTC window. The `overnight-phase-runner` edge function (cron `*/15 * * * *`, no-ops outside the night window) generates an observation-only briefing — summary, risks, recommendations — using the cheap model and writes it back to the row. Cancel via `cancel_overnight_run(_id)` RPC. Surfaced in `OvernightQueueCard` on `/roadmap` (queued + recent runs with model + cost). No roadmap state mutation — operator reviews the briefing in the morning.
- **Phase quality gates + Proceed action** — phases now have a derived `roadmap_phase_gate_status` view that combines four gates: structural (all tasks done/wont_do), QA (all `qa_checks` pass for the phase key), night audits (no open high-severity `night_task_audit` rows on tasks in the phase), and approvals (no pending `roadmap.phase_signoff` in `approval_queue`). On `/roadmap` the phase badge becomes **DONE · gates fail** (amber, with blocker tooltip) when a phase is marked done but a gate fails, or **READY TO SIGN OFF** (emerald) when active and all gates pass. Each phase row shows a small `<PhaseGateChip />` listing blockers. The header gets a context-aware **Proceed** button next to *Next up* that picks the right next step (`Start task`, `Decide approval`, `Open work log`, `Close sprint`, `Request phase sign-off`) based on gate state + next-up task. `Request phase sign-off` inserts an idempotent `roadmap.phase_signoff` row in `approval_queue`; the new `roadmap-phase-signoff` edge function flips `roadmap_phases.status='done'` once the operator approves it and emits `capability_events.phase.signed_off`. Pure decider in `src/lib/proceed.ts` with 9 unit tests.
- **Roadmap layout — tree-first** — `/roadmap` is now a 4-tab page (`Roadmap | Daily plan | Automation | Activity`). The phase/sprint/task tree paints above the fold instead of being pushed below `DailyPlanCard` + `AutomationPanel` + `WorkLogPulse` + `TurnTracker`. Inside the task detail panel, **Approval / Review checklist / Research evidence** are now an `<Accordion>` (Approval default-open) instead of three permanently-expanded sections. `AutoLogSettings` is reachable from a Sheet on the Automation tab. Header shrunk to `text-xl` and uses the canonical container `max-w-7xl px-4 py-4`. Pure UI move — no schema or fetch changes.
- **Control Plane — windowed event stream + paged demand table** — the live event feed is now bounded by a time-window control (`15m | 1h | 24h | 7d`, default `1h`) instead of a fixed 200-row in-memory cap. Switching the window trims the array immediately; "Load older" bumps to the next notch when empty. The demand table has a `Show 50 / 200 / all` page-size control and lives inside its own scroll container with a `max-h-[60vh]` cap. Files extracted: `src/components/control-plane/EventStream.tsx`, `src/components/control-plane/DemandTable.tsx`. `ControlPlane.tsx` shrunk from 566 to ~95 lines.
- **Telegram bot config moved to /admin** — the bot identity card, chat-id picker, send-test button, and mismatch banner now live in a new `TelegramBotPanel` rendered on the Admin page (`#telegram` anchor). Control Plane keeps a one-line status chip (`Telegram: @bot ✓`) that links to it. Separates runtime ops (event feed, approvals) from config + secrets-shaped UI.
- **Pluggable pane sources** — the right and bottom panes are no longer hardcoded to Night Agent / event ticker. Each pane has a small picker in its header (icon + label dropdown) and falls back to a smart per-route default (`/jobs` → discussion actions, `/admin` → approvals, `/roadmap` → approvals, `/night` → Night Agent, etc.). Two new sources ship today: **Pending approvals** (live `approval_queue` where status='pending') and **Discussion actions** (open `discussion_actions`). All four sources draw their tint from the design system (`tint-night`, `tint-event`, `tint-approval`, `tint-discussion`). Source overrides persist per route + viewport in `awip.panes.v1` alongside the existing size overrides; the global "Reset layout" button clears them. Bodies are lazy-loaded so a source you don't pick doesn't run its query. New: `src/lib/pane-defaults.ts`, `src/components/panes/sources.ts`, `src/components/panes/PaneSlot.tsx`, four bodies under `src/components/panes/bodies/`. See `docs/operator-panes.md`.
- **Design system doc + semantic tints** — new [`docs/design-system.md`](docs/design-system.md) sets the canonical page container (`max-w-7xl px-4 py-4`), header pattern, spacing scale, table density, and tabs-vs-accordions rules for the operator console. Adds seven semantic tint tokens (`tint-night`, `tint-event`, `tint-approval`, `tint-discussion`, `tint-capability`, `tint-risk`, `tint-okr`) as HSL CSS vars in `src/index.css` (light + dark) exposed via `tailwind.config.ts`. Tints are signal-only — used as text/border or low-alpha backgrounds (`bg-tint-approval/15`), never primary surface fills. Each operator pane source (Night Agent / Events / Approvals / Discussion) gets a canonical tint so sidebar dots, pane headers, and badges stay consistent. Additive: no existing component changes.
- **Operator dashboard** — new `/dashboard` route (top of sidebar Operate group) with 1–4 named tabs, fixed bento templates (`2×2`, `1+3`, `hero-strip`, `dense-6`), and a small widget contract (`DashboardWidgetProps`, `WidgetRegistry`). Four seeded widgets reuse existing hooks: pending approvals, night observations (24h), open risks (`roadmap_review_findings` where `acknowledged = false`), recent capability events. Config persists in new `operator_dashboards` table (one row per user, operator-only RLS), debounced saves at 800ms idle, tab switches saved immediately. First visit auto-seeds a `Today` tab. See `docs/operator-dashboard.md`.
- **Sidebar redesign** — left navigation now has a per-operator **Favorites** section at the top (hover any row → click the star to pin, max 6, persisted in `localStorage`) and a collapsible **Copilot** subgroup under Operate (Agents / Profile / Lessons / Transcripts) that auto-opens when you're inside `/copilot/*`. Single restrained palette: monochrome icons, one active treatment per row (fill + 2px left border), and right-aligned status dots driven only by real signals (pending `approval_queue` rows on `/admin`, recent `night_observations` on `/night-shifts`). New `src/lib/sidebar-state.ts` hooks (`useFavorites`, `useCopilotOpen`, `useStatusDots`). See `docs/operator-sidebar.md`.
- **Operator pane toggles** — header now has a 4-mode pane row (Cursor-style): `left only`, `dual` (left + right Night Agent feed), `centre` (focus, all panes closed), `bottom` (left + live event ticker). Switch via icon row or `⌘1`–`⌘4`. Right pane streams the latest 30 `night_observations` in real time with a UTC night-window status dot. Bottom pane merges `okr_node_events` + `capability_events` + `discussion_action_events` (capped at 200, pause/resume, source tabs). Mode is persisted per top-level route in `localStorage` under `awip.panes.v1`. Mobile (<768px) is forced to centre. See `docs/operator-panes.md`.
- **Promotion audit report** — admin page at `/admin/promotion-audits` and a drawer reachable from `/night-shifts` show the exact before/after of every operator-confirmed Night Agent promotion: open-time gate snapshot, shift-level skip reasons, and the selected/skipped candidates list. New `awip-api` endpoint `GET /night-agent/promotion-audit?proposal_id=…|shift_id=…` (admin-only). Pure assembler + 5 Deno tests in `supabase/functions/awip-api/promotion_audit.ts`. `night-agent/open` now persists `gates`, `candidates_selected`, `candidates_skipped` on `night_shifts.summary` and stamps each `night_proposals.payload` with `gates_snapshot_ref` + `selected_at`. Legacy shifts without a snapshot are flagged `legacy: true` instead of failing. See `docs/promotion-audit.md`.
- **Capability Phase-3 promotion workflow** — admin page at `/admin/capability-promotion` evaluates 8 maturity gates per capability (manifest, inputs/outputs, connector wiring, dependency resolution, OKR demand, Phase-3 QA, open approvals, current status) and shows the failure reason and operator action for each. New `awip-api` endpoints `GET /capabilities/promotion-status`, `GET /capabilities/:id/promotion-status`, `POST /capabilities/:id/promote`, `POST /capabilities/:id/ack-warnings` (admin-only, idempotent). Pure evaluator + Deno tests in `supabase/functions/awip-api/promotion_gates.ts`. New `capability_events` types `promoted_to_available` and `warnings_acknowledged`. Promotion banner added to `/capabilities/:id`. See `docs/capability-promotion.md`.
- **Task approval workflow** — `roadmap_tasks` gains `review_status` (pending / approved / rejected / changes_requested), `reviewed_by`, `reviewed_at`, `review_notes`. New append-only `roadmap_task_reviews` table records every decision with a snapshot of the checklist state, reviewer, and notes. New `TaskApprovalPanel` on `/roadmap` lets operators approve / request changes / reject / reopen a task; rejection requires notes; approving with an incomplete checklist prompts confirmation. Status pill is shown inline on each task row. History view exposes the full audit trail. Operator-only RLS (insert + read; no edit/delete on history).
- **Per-task review checklist** — new `roadmap_task_checklist` table + `ReviewChecklistEditor` on `/roadmap` task panels. Operators can seed the standard review template (acceptance line, RLS migration, no plaintext secrets, events emitted, idempotency replay, CHANGELOG, sources, risk flags) or add custom items, tick them off (records `checked_by` + `checked_at`), add per-item notes, and attach scoped research evidence per checklist item via the existing `EvidencePanel`. Operator-only RLS + realtime + progress bar.
- **Research evidence on roadmap tasks** — new `roadmap_task_evidence` table + private `roadmap-evidence` storage bucket. Each evidence row links a task (and optional checklist item key) to a URL, uploaded file, or note, with title, source citation, and `added_by` for auditability. Surfaced on `/roadmap` task panels via the new `EvidencePanel` component (realtime). Operator-only RLS on both table and bucket; uploaded files served via short-lived signed URLs.
- **Daily plan** — `daily-plan` edge function (cron `30 5 * * *`) summarises open roadmap tasks, recent work-log activity, unresolved findings, failing QA probes, recent test runs, and pinned notebook entries via Lovable AI Gateway (`openai/gpt-5`) into `daily_plans` (one per day). Surfaced in the new **Daily plan** card on `/roadmap` with focus, plan markdown, risks, and recommendations. Operator-only RLS + realtime.
- **Phase 5 / 6 / 6b roadmap expansion** — added 9 new sprints (s5.2, s5.3, s6.2–s6.6, s6b.2, s6b.3) and ~50 tasks covering entity resolution, canonical ingest spine, source adapters, conflict layer, PII/DSAR, RAG, compliance hooks, and operator SLAs. Tasks carry one-line acceptance criteria sourced from the pinned notebook research.

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
