# Project Memory

## Core
AWIP Core: operator console + contract API. Substrate, not a brain — records OKRs and capability manifest, emits events; no "who acts when" logic.
Stack: React + Vite + Tailwind + Lovable Cloud (Supabase). Single edge function `awip-api` for the contract surface.
Every OKR mutation → `okr_node_events`; every manifest change → `capability_events`; all write endpoints idempotent via `Idempotency-Key`.
Auth: operator JWT or `x-awip-service-token` (cross-project). Roles in `user_roles` via `has_role()`; never store roles on profiles.
Cron jobs (`scheduled-code-review`, `qa-validate`, `record-test-run`, `night-agent-open`, `night-agent-close`, `overnight-phase-runner-15m`, `overnight-prequeue`, `scheduled-overnight-recommender`, `scheduled-morning-review`, `scheduled-sentinel-tick`, `scheduled-lessons-daily`, `scheduled-lessons-weekly`, `scheduled-deep-audit-weekly`, `scheduled-deep-audit-monthly`, `scheduled-app-walkthrough`, `scheduled-awip-reviews-pull`, `scheduled-quarterly-review-open`, `scheduled-tomorrow-plan-refresh`, `ci-status-sync-30m`) auth with `AWIP_SERVICE_TOKEN`; all new tables operator-only RLS + realtime.
Git provider: project IS mirrored to `cjaisingh/verdent-ideas-spark` (verified via failing GH Actions runs referencing files created here). Edits to `supabase/functions/*` and `eslint.config.js` land there. Verify before claiming CI is green — poll the GitHub API with `GITHUB_REVIEWS_TOKEN` after a push lands.
ALL edge functions must be wrapped with `withLogger` from `_shared/logger.ts` (or carry `// @logger-exempt: <reason>` at top) — `scripts/check-logger-coverage.ts` is enforced by Logger Validation workflow.
Night Agent audits open `discussion_actions.night_eligible=true` only — gated by new `risk` field via `enforce_night_eligibility_by_risk` trigger: `critical` never night-shift (hard block), `high` requires `night_override_reason`. Roadmap phase generation overnight is a separate opt-in via `roadmap_phases.run_overnight` (auto-queued at 21:55 UTC by `overnight-prequeue`) or per-run "Run overnight" button.
Night window 22:00–06:00 UTC also forces every AI job to `google/gemini-2.5-flash-lite` via `supabase/functions/_shared/model-policy.ts → pickModel()`. TTS bypasses this — `gemini-tts` always uses the requested TTS model.
Weekly AWIP Reviews are pulled Mon 05:30 UTC from the **separate** repo `cjaisingh/verdent-ideas-spark/docs/reviews` (private — needs `GITHUB_REVIEWS_TOKEN`); each finding fans out to RAG + discussion_action + (high/critical) sentinel.
Quarterly reviews open Jan/Apr/Jul/Oct 1 @ 09:00 UTC via `quarterly-review-open` → idempotent `discussion_action` linking to `docs/quarterly-review.md`.
Ontology of 11 entities locked at `docs/ontology.md` and surfaced at `/ontology` (W1.1). Source of truth is the markdown file — no editing UI; changes go through git + CHANGELOG.
Truth arbitration goes through `public.resolve_truth(entity, entity_id, field)` against `decision_authorities` (W7.1) + `claims` (W7.2). Rules are git-versioned via migrations + CHANGELOG; no editing UI. Defaults: operator beats AI for every entity; CI hard-owns TestRun; system hard-owns CapabilityEvent. Resolver picks winner by precedence then weight×confidence; status `resolved`/`conflict`/`no-claims`. Claims via /governance UI or `claims-ingest` edge fn; `truth_conflicts_unresolved` sentinel surfaces ties.
Governance chain (W7.1.5): `governance_links` (task↔notebook↔entity↔authority_rule, relations touches/justifies/governs/supersedes) + `governance_chain()` + `governance_coverage()` surfaced at `/governance`. Manual links only, no backfill, no enforcement — coverage starts at 0% by design to make holes visible before W7.2.
Docs are reference, not narrative. `mem/**` ≤30 lines, `docs/**` ≤200, index entries ≤150 chars. Prune in same edit.
Read live before planning (query `sentinel_findings`/`automation_runs`, not cached state); default hypothesis on a finding is "detector wrong" before "system broken"; verify-before-scope.
"Deployed" ≠ "verified" — run the relevant check (test/curl/read_query/findings re-query/console) and cite the persona consulted from `docs/agents/team/` before planning. See [verify-completion](mem://preferences/verify-completion).



## Memories
- [Ontology](mem://features/ontology) — 11 canonical entities with lifecycle/ownership/audit; source docs/ontology.md, surface /ontology
- [Decision Authority (W7.1)](mem://features/decision-authority) — decision_authorities table + resolve_truth(); operator>ai default, git-versioned rules, read-only card on /ontology
- [Governance Joins (W7.1.5)](mem://features/governance-joins) — links + chain + coverage + uncovered-tasks worklist on /governance (click → auto-opens AddLinkDialog on missing leg)
- [Claims pipeline (W7.2)](mem://features/claims-pipeline) — claims/claim_events tables, real resolve_truth winner selection, truth_conflicts view, claims-ingest edge fn, ClaimsPanel on /governance, truth_conflicts_unresolved sentinel
- [Automation jobs](mem://features/automation) — cron cadences, tables, alert webhook contract
- [Doc structure](mem://preferences/docs) — where to add docs and how to update README + CHANGELOG
- [Night Agent](mem://features/night-agent) — eligibility rules, 5-step pipeline, night_task_audit view
- [Jobs board risk](mem://features/jobs-board-risk) — risk field + trigger gating night eligibility (critical never, high needs override)
- [Night-cheap models](mem://features/night-cheap-models) — pickModel helper + overnight phase queue ("Run overnight")
- [Overnight Recommender](mem://features/overnight-recommender) — 21:30 UTC SQL suggester of phases to run overnight; click-to-queue card on /master-plan + retro line on Morning Review
- [Morning Review (W2)](mem://features/morning-review) — daily 06:00 UTC aggregator + page + mirror action
- [Morning Review triage](mem://features/morning-review-triage) — per-PANEL Focus/Revisit/Done/Skip chip (one per panel, not per row), sticky on panel slug, Discuss-next strip
- [Tomorrow Plan](mem://features/tomorrow-plan) — operator daily plan dashboard on /morning-review (Tomorrow tab); tomorrow_plans*/items + 15-min auto-refresh
- [Sentinel Agent (W3)](mem://features/sentinel) — 15-min watcher, sentinel_findings table, rolled into morning review
- [Edge Function Health](mem://features/edge-health) — sentinel checks + /admin/edge-health page + safeInvoke wrapper + client-error-beacon for browser transport fails
- [Jobs status panel](mem://features/jobs-status-panel) — /admin/jobs live runs + step timeline + edge-log tail; runs↔steps↔logs joined by request_id (threaded via withLogger ctx)
- [Lessons Loop (W4)](mem://features/lessons-loop) — weekly AI synthesis into public.lessons + /admin/lessons
- [Deep Audit (W5)](mem://features/deep-audit) — weekly+monthly platform audit, 5 modules, auto-promotes high/critical to lessons, /audits page
- [App Walkthrough](mem://features/app-walkthrough) — nightly 02:15 UTC route + capability self-test sweep, failures → sentinel
- [AWIP Reviews](mem://features/awip-reviews) — Mon 05:30 UTC pull of weekly external reviews → RAG + actions + sentinel
- [Review cadence](mem://preferences/review-cadence) — full per-PR/daily/weekly/monthly/quarterly cadence map (cite this when asked "how often is X reviewed?")
- [CI/CD hardening (W6)](mem://preferences/ci-cd-hardening) — workflow inventory + branch-protection checklist for `main`
- [Lint policy](mem://preferences/lint-policy) — `no-explicit-any` ratcheted via `.lint-baselines/no-explicit-any.json`; clean files auto-promoted to error; cleanup tracked by action #20
- [Verification discipline](mem://preferences/verification-discipline) — sandbox-verifiable vs not + plan-before-fix rules (read live, detector-wrong-first, verify-before-scope)
- [Doc hygiene](mem://preferences/doc-hygiene) — caps: mem ≤30 lines, docs ≤200, index ≤150 chars; .md is reference not narrative
- [Verify completion](mem://preferences/verify-completion) — per-change-type DoD checks + binding persona-consultation map (9 agents in docs/agents/team/)
- [AWIP Companion](mem://features/companion) — `/companion` browser chat (Ollama + RAG) and Rork iPhone surface; Gemini TTS is the default voice
- [Gemini TTS](mem://features/gemini-tts) — `gemini-tts` edge function, 8 voices, audio/wav, ai_usage_log, used by Rork iPhone app
- [Rork iPhone spec](docs/rork-companion-spec.md) — contract between Core and the separate Expo project
- [Realtime channel naming](mem://preferences/realtime-channel-naming) — unique per-mount names for `supabase.channel()`; sentinel watches for regressions
- [Chat-first for policy/threshold requests](mem://preferences/chat-first-policy-requests) — confirm event def + thresholds + notify target + scope via ask_questions before building monitoring/alert/policy features
- [Voice pipeline health](mem://features/voice-health) — /admin/voice-health page + voice_pipeline_red sentinel check; 1h window, 2%/10%/no-success-60min bands
- [Playbook: voice + chat-first](docs/playbooks/voice-and-chat-first.md) — persistent in-app guide at /playbooks/voice-chat-first; 5-step voice setup + 4-question chat-first checklist
- [Worker reliability](mem://features/worker-reliability) — heartbeat/attempts/max_retries on roadmap_phase_overnight_runs + night_shifts; reclaim_stale_night_jobs called from sentinel-tick; auto_blocked terminal status
- [Platform allowlist](mem://features/platform-allowlist) — default-deny is_principal_allowed() gating telegram-webhook, companion-cloud-chat, gemini-tts; allowlist_rejects sentinel >50/24h; /admin panel
- [Delta lint](mem://features/delta-lint) — _shared/delta-lint + lint-delta endpoint + lint_delta_runs table; deno check + JSON.parse; lint_delta_failures sentinel; surfaced on /admin/edge-health
- [Companion auto-resume](mem://features/companion-resume) — companion_messages.status+streamed_at heartbeat, companion_session_state for last-active thread, ResumeBanner, companion_streams_stalled sentinel
- [HeyGen videos](mem://features/heygen-videos) — quarterly recap + external pitch generator on /admin/videos; free plan 3/mo ≤60s; cron polls every 2min; heygen_videos_failed sentinel
- [Sentinel triage activity](mem://features/sentinel-triage-activity) — discussion_action_findings junction + auto_link_finding_to_action() called from sentinel-tick + sentinel_triage_activity stream + TriageBadge on Morning Review row; 90-day retention
- [QA audit log](mem://features/qa-audit) — qa_check_events table + log_qa_check_event trigger + /roadmap/qa-audit page; qa_checks now carries last_actor/last_actor_label/last_action; inline Pass/Fail + bulk override on /roadmap/gate-diagnostics
- [Contract-first agents](mem://preferences/contract-first) — typed input contracts in supabase/functions/_shared/contracts/ before adding any new cron/edge-fn/agent loop; see docs/agents/contract-checklist.md and night-agent.ts reference
- [Retrieval shapes](mem://preferences/retrieval-shapes) — Phase 5/6 prep: 5 data shapes (prose/hierarchical-doc/tabular/graph/time-series) need different stores not just different parsers; declare retrieval contract per agent surface before picking a vendor
- [Phase 5/6/6b prep](mem://features/phase-5-6-prep) — 4 retrieval contracts (ingest-concierge/validation/resolver/conflict-triage) + source-adapter contract + ADR-0003..0006 stubs (ancestry/alias-revoke/bulk-conflict/embedding); scaffolding only, decisions per-sprint
- [Credits & Usage](mem://features/credits-usage) — credit_entries + credit_settings + credit_balance_snapshots; runway + per-phase deltas + end-of-phase balance prompt on /admin/ai-usage
- [Tool Policy](mem://features/tool-policy) — tool_policy_rules + tool_policy_recommendations + v_tool_policy_signals; deterministic recommender (Lovable/Claude/Cursor/Codex) on /admin/ai-usage Tool Policy tab
- [Budget alerts](mem://features/budget-alerts) — sentinel-tick check fires at 80%/100% projected month-end (burn_7d×30/budget); credit_alerts table + BudgetAlertBanner + Telegram via telegram-send; once per (year_month, threshold)
- [Alert delivery to Telegram](mem://features/alert-telegram-delivery) — dispatchAlert posts to webhook AND telegram-send; alert_settings.operator_telegram_chat_id seeded; daily heartbeat in sentinel-tick if no telegram-send in 25h
- [Sentinel monitoring coverage](mem://features/sentinel-monitoring-coverage) — SENTINEL_CADENCES must list every essential cron + automation_runs query must filter by .in(job,...) to dodge PostgREST 1000-row cap; telegram_webhook_silent + approvals_stale watch the operator channel
- [AI Jobs / Ollama worker](mem://features/ai-jobs-ollama) — pull-based queue (ai_jobs/ai_job_results/ai_draft_outputs/ai_workers); 5 edge fns + sentinel checks shipped; UI + worker script still TODO
- [Per-task cost accounting](mem://features/cost-per-task) — ai_usage_log.task_id+module, v_ai_cost_per_sprint, SprintCostRollup on /master-plan; forward-only attribution
- [AI attribution mappings](mem://features/ai-attribution-mappings) — ai_module_mappings (pattern→module) + ai_module_task_pins (module→task,window) drive infer_ai_job_module + 3-phase backfill; /admin/ai-usage Attribution tab
- [Postmortems](mem://features/postmortems) — auto-postmortem on phase/sprint slip; daily 06:30 UTC cron + /postmortems page; draft/reviewed/archived + editable fields + postmortem_events audit + evidence[] (sentinel/runs/actions/cost spikes/log errors) persisted on the row to back the AI's root cause
- [Live platform timeline](mem://features/automation-steps) — automation_steps + p95 view + recordStep helper + /admin/timeline page + Morning Review chip; instruments sentinel-tick, postmortem-generate, morning-review, night-agent, overnight-phase-runner
- [Sentinel check perf](mem://features/sentinel-perf) — sentinel_check_runs + v_sentinel_check_perf_24h + /admin/sentinel-perf; per-check latency/retries/queue-depth; dispatchAlert returns {delivered,attempts}
- [ADR bench history](mem://features/adr-bench-history) — /admin/adr-bench + adr_bench_results table + uploadBenchResult() in scripts/adr-bench/_shared.ts; status pill in src/lib/adr-bench-thresholds.ts mirrors docs/adr/benchmarks.md thresholds
- [Entity resolver (Phase 5 s5.1)](mem://features/entity-resolver) — tenant_nodes/aliases/conflicts/events + entity-resolve edge fn; authoritative→alias_exact→alias_fts; cross-tenant gate test; ancestry/weights/embedding_hint deferred to s5.2
- [ISO 42001 gap analysis](docs/iso42001-gap-analysis.md) — AIMS view of current AI surfaces, clauses 4–10 + Annex A, prioritised gap log; sibling to docs/iso27001-controls.md
- [AI model policy](mem://features/ai-policy) — single chokepoint `pickModel()`: night-window flash-lite coercion + TTS bypass + contract-first new loops + budget-alert demotion

- [Module contracts](mem://features/module-contracts) — per-module hashed tokens, `module_heartbeats`, idempotent `/capabilities/register`, granular `status_changed`/`version_bumped`/`deprecated`/`owning_module_changed` events, `/modules/heartbeat`, `module_silent_24h` sentinel
