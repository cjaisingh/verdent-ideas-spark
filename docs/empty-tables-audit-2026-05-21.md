# Empty-tables audit — 2026-05-21

37 `public.*` tables have `n_live_tup = 0`. Each row below records why the table exists, who should populate it, and the verdict. **No drops in this PR** — verdicts feed the wire-up follow-up (task 4) and a later cleanup PR.

Method: queried `pg_stat_user_tables`, then `rg` for `from('<table>')` / `INSERT INTO <table>` across `supabase/functions` and `src/`. "Writer present" means at least one code site inserts; it does not prove the writer is reachable.

Legend:
- **wire-up** — writer is missing or broken; fix before judging the feature
- **keep — populator-blocked** — writer exists but upstream trigger (cron, manual action, external event) hasn't run yet
- **keep — low-traffic** — writer exists and is correct; table is genuinely event-sparse
- **drop-candidate** — no writer, no obvious owner, table is dead weight

| Table | Owner feature | Writer site(s) | Verdict | Notes |
|---|---|---|---|---|
| `agent_onboarding_sessions` | Copilot onboarding | none found | drop-candidate | No code references; likely abandoned scaffolding |
| `ai_draft_outputs` | AI Jobs / Ollama worker | `ai-jobs-complete` | keep — populator-blocked | No worker has connected yet (see `mem://features/ai-jobs-ollama`) |
| `ai_job_results` | AI Jobs | `ai-jobs-complete` | keep — populator-blocked | Same as above |
| `ai_jobs` | AI Jobs | `ai-jobs-claim/heartbeat/complete/fail` + `AdminAiJobs.tsx` | keep — populator-blocked | Pull-based queue with no producer wired yet |
| `ai_module_task_pins` | AI attribution | manual + `/admin/ai-usage` Attribution tab | keep — low-traffic | Operator-curated pins; expected to be sparse |
| `ai_workers` | AI Jobs | `ai-jobs-claim` heartbeat | keep — populator-blocked | No worker registered |
| `alert_cost_thresholds` | Budget alerts | manual | keep — low-traffic | Settings table; rows added when operator sets thresholds |
| `capability_connectors` | Capability registry | none found | drop-candidate | Schema present but no insert path in code |
| `connection_audit_log` | Connector audit | none found | drop-candidate | No writer; superseded by other audit log |
| `copilot_agent_overrides` | Copilot persona overrides | `useCopilotAgents.ts` writes | keep — low-traffic | Per-operator override row only on customisation |
| `copilot_lessons` | Copilot lessons surfacing | none found | wire-up | Hook reads it but nothing populates — pipeline gap |
| `credit_alerts` | Budget alerts | `sentinel-tick` budget check | keep — populator-blocked | Fires only when month-end projection crosses 80%/100% |
| `credit_entries` | Credits & Usage | `AddCreditEntryDialog.tsx` + `BalanceTrackingPanel.tsx` | keep — populator-blocked | Operator-driven ledger; awaiting manual reconciliation |
| `deferred_items` | Plan deferral (legacy) | none found | drop-candidate | Superseded by `discussion_actions.source='plan_footer'` (this PR) |
| `frontend_error_logs` | Client-error beacon | `frontend-error-capture.ts` | wire-up | Need to confirm beacon endpoint is wired; zero rows in 14d looks wrong |
| `governance_deeplink_events` | Governance UI telemetry | `governance-telemetry.ts` | keep — populator-blocked | Fires only when operator clicks deep-link chips |
| `lesson_events` | Lessons Loop audit | `lessons-synthesize` | keep — populator-blocked | Only emitted on weekly cron — next run pending |
| `lessons_backfill_runs` | Lessons backfill | none found | drop-candidate | One-shot backfill table; can drop after audit |
| `lint_delta_runs` | Delta lint | `delta-lint.ts` shared | wire-up | `lint-delta` edge fn exists but no caller in code path — see `mem://features/delta-lint` |
| `overnight_recommendations` | Overnight Recommender | `scheduled-overnight-recommender` | keep — populator-blocked | 21:30 UTC cron; will populate tonight |
| `postmortem_events` | Postmortems audit | `postmortem-generate` trigger | keep — populator-blocked | Only on first postmortem |
| `postmortems` | Postmortems | `postmortem-generate` + `PostmortemDrawer.tsx` | keep — populator-blocked | Daily 06:30 UTC cron; only fires on slip detection |
| `rethink_tasks` | Rethink loop (legacy) | none found | drop-candidate | No code references |
| `roadmap_autolog_skips` | Roadmap autologger | none found | drop-candidate | Schema present but unused |
| `roadmap_task_checklist` | Roadmap checklist | none found | wire-up | UI exists; populator missing |
| `roadmap_task_evidence` | Roadmap evidence | none found | wire-up | Same as above |
| `roadmap_task_reviews` | Roadmap reviews | none found | wire-up | Same as above |
| `role_change_audit` | Role audit | DB trigger on `user_roles` | keep — populator-blocked | Trigger present, no role changes yet |
| `runbooks` | Runbooks page | `Runbooks.tsx` UI write | keep — low-traffic | Operator-curated |
| `session_summaries` | Session lifecycle | `session-summary-log` (this PR) | keep — populator-blocked | Endpoint just shipped — will populate as sessions end |
| `short_links` | Short link service | `src/lib/short-link.ts` | keep — populator-blocked | Generated on demand |
| **`telegram_send_log`** | **Observability gate (this PR)** | **NO WRITER** | **wire-up — CRITICAL** | Migration `20260521084921` created the table; `telegram-send/index.ts` was NEVER updated to insert. Sentinel checks `telegram_send_failures_burst` / `telegram_outbound_silent` will read empty data forever until this is fixed |
| `test_runs` | CI test runs | `record-test-run` edge fn | keep — populator-blocked | Hits from CI; depends on workflow wiring |
| `tool_policy_recommendations` | Tool policy | `ToolPolicyPanel.tsx` | keep — populator-blocked | Operator generates on demand |
| `voice_config` | Voice setup | `/voice-setup` UI | keep — low-traffic | Single-row settings |
| `workstream_signoff_events` | W7 sign-off audit | trigger on `workstream_signoffs` | keep — populator-blocked | No sign-offs yet |
| `workstream_signoffs` | W7 sign-off | manual | keep — populator-blocked | Awaiting sign-offs |

## Verdict totals

- **wire-up**: 6 (`copilot_lessons`, `frontend_error_logs`, `lint_delta_runs`, `roadmap_task_checklist`, `roadmap_task_evidence`, `roadmap_task_reviews`) + **`telegram_send_log` (critical)**
- **drop-candidate**: 7 (`agent_onboarding_sessions`, `capability_connectors`, `connection_audit_log`, `deferred_items`, `lessons_backfill_runs`, `rethink_tasks`, `roadmap_autolog_skips`)
- **keep — populator-blocked**: 18
- **keep — low-traffic**: 5

## Critical finding

**`telegram_send_log` has no writer.** The contract-gate PR that introduced this table claimed to rewrite `telegram-send/index.ts` to log every attempt. That rewrite never landed. Until task 4 fixes it:

- Sentinel `telegram_send_failures_burst` will never fire (it reads `telegram_send_log` for failures).
- Sentinel `telegram_outbound_silent` will fire **permanently** (it sees zero successes for >24h regardless of real activity) — operator alert fatigue risk.

Recommend wiring this in task 4 before any of the new sentinel checks are trusted.

## Next steps

- Task 4 fixes the 6 + 1 critical `wire-up` rows.
- A later PR (not in this batch) drops the 7 drop-candidates after operator review.
- `keep — populator-blocked` rows need no action — re-check in 30 days.
