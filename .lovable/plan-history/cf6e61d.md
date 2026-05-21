## Next 10 tasks — validated against current repo + DB state

State checked before drafting:
- `out_of_scope_stale` sentinel check **shipped** (`sentinel-tick/checks.ts:1120`, wired at `index.ts:336`).
- `plan-footer-ingest` has `parser_test.ts` only — no `index_test.ts` for the HTTP path. `session-summary-log` has zero tests.
- `docs/out-of-scope-autolog.md` exists; `docs/session-lifecycle.md` and `mem/features/out-of-scope-autolog.md` **do not** (index references them but files are missing).
- `AGENTS.md` does not yet require POSTing plans to `plan-footer-ingest`.
- `observability_registry` has 31 rows; `telegram_send_log` is empty (gate shipped, no traffic yet).
- 37 `public.*` tables have zero rows (your earlier flag — still unresolved).

Tasks are sequential; each ends with a verification step.

### 1. Close out the out-of-scope autologger (steps 6–8 of approved plan)

- Add `supabase/functions/plan-footer-ingest/index_test.ts`: three fixtures (new plan → 3 created, re-post → 0 created/3 skipped, no section → 0/0/0). Hit the deployed function via `curl_edge_functions`.
- Add `supabase/functions/session-summary-log/index_test.ts`: posts a synthetic summary with `out_of_scope:["x","y"]`, asserts 2 rows in `discussion_actions` with `source='session_summary'`, source_ref starts with `session:`.
- Add sentinel fixture: insert a `discussion_actions` row dated 15 days ago with `source='plan_footer'`, manually invoke `sentinel-tick`, assert one `out_of_scope_stale` finding.
- **Verify**: `supabase--test_edge_functions` green; `read_query` on `sentinel_findings` shows the new finding.

### 2. Backfill the missing docs + memory referenced by `mem/index.md`

- Create `mem/features/out-of-scope-autolog.md` (the index links it but the file is absent).
- Create `docs/session-lifecycle.md` — the session-start / session-end checklist already shipped two messages ago references this path.
- Append a paragraph to `AGENTS.md` working agreements: "Every plan with an out-of-scope footer MUST be POSTed to `plan-footer-ingest` before claiming done."
- **Verify**: `rg "out-of-scope-autolog|session-lifecycle" mem docs` returns the new files.

### 3. Empty-tables audit (your earlier flag, still open)

Generate `docs/empty-tables-audit-2026-05-21.md` covering all 37 zero-row `public.*` tables:

```text
agent_onboarding_sessions, ai_draft_outputs, ai_job_results, ai_jobs, ai_module_task_pins,
ai_workers, alert_cost_thresholds, capability_connectors, connection_audit_log,
copilot_agent_overrides, copilot_lessons, credit_alerts, credit_entries, deferred_items,
frontend_error_logs, governance_deeplink_events, lesson_events, lessons_backfill_runs,
lint_delta_runs, overnight_recommendations, postmortem_events, postmortems, rethink_tasks,
roadmap_autolog_skips, roadmap_task_checklist, roadmap_task_evidence, roadmap_task_reviews,
role_change_audit, runbooks, session_summaries, short_links, telegram_send_log, test_runs,
tool_policy_recommendations, voice_config, workstream_signoff_events, workstream_signoffs
```

For each row: **owner feature** / **expected populator** / **last write attempt** (from `pg_stat_user_tables.last_*`) / **verdict** (`keep — populator-blocked`, `keep — low-traffic`, `drop`, `wire-up`). No drops in this PR.

- **Verify**: doc lists all 37; verdicts add up; ship as `discussion_action` so wire-up follow-ups are tracked.

### 4. Wire up the highest-value empty tables flagged in task 3

Likely candidates (subject to audit): `postmortems`, `lint_delta_runs`, `telegram_send_log`, `credit_entries`. For each that has a shipped feature but no writer:

- Locate the call site that *should* be inserting (grep the codebase).
- Either fix the writer or remove the feature flag pointing at it.
- One migration per table only if a schema bug is the blocker.

- **Verify**: `read_query select count(*)` > 0 on each wired-up table after triggering the relevant cron / action.

### 5. Sentinel cadence card for the autologger gate

Add `out_of_scope_stale` + `telegram_send_failures_burst` + `telegram_outbound_silent` + `observability_coverage_gap` to `mem/features/sentinel-monitoring-coverage.md` so the cadence inventory stays accurate (memory says "anything not listed is NOT watched" — these aren't listed).

- **Verify**: `rg "out_of_scope_stale" mem/features/sentinel-monitoring-coverage.md` hits.

### 6. Operator surface for the observability registry

`/admin/observability-registry` read-only page:
- Columns: surface_kind, surface_id, expected_cadence, watcher_kinds, owner, declared_in, last_seen (from `automation_runs` for crons, `edge_request_logs` for fns), status pill.
- Sort: missing-watcher first, then stalest.
- No write UI — registry is declared in migration.

- **Verify**: page loads, 31 rows render, status pill colour-codes correctly.

### 7. Telegram send-failure smoke test (closes the contract gate loop)

The gate shipped without a live test. Add `e2e/telegram-send-failure.test.ts`:
- Hit `telegram-send` with `x-force-fail: 1` header → assert row in `telegram_send_log` with `status='failed'`.
- Hit normally → assert `status='success'`.
- Repeat 3× with force-fail → assert sentinel `telegram_send_failures_burst` fires.

- **Verify**: `bunx vitest run e2e/telegram-send-failure.test.ts` green; sentinel finding visible.

### 8. Session-lifecycle skill scaffold

`mem/index.md` references a `awip-session-lifecycle` skill but `.workspace/skills/` doesn't exist. Either:
- (a) write the draft under `.agents/skills/awip-session-lifecycle/SKILL.md` and `skills--apply_draft`, or
- (b) remove the reference from any doc that points at it.

Pick (a). Skill content = the session-start / session-end checklist already drafted in chat.

- **Verify**: skill applied, surfaces under `skill/awip-session-lifecycle` when prompted.

### 9. CHANGELOG + memory index sync

Single sweep:
- Append entries for tasks 1–8 to `CHANGELOG.md`.
- Update `mem/index.md` core section if any rule changed (e.g. "all plans → plan-footer-ingest").
- Confirm `mem/index.md` Memories list references match files on disk (one drift found this loop — `out-of-scope-autolog`).

- **Verify**: `bun run scripts/check-doc-drift.ts` (or equivalent) passes.

### 10. Closing audit: re-run all sentinel checks once, paste counts

- Manually invoke `sentinel-tick` once after tasks 1–9 land.
- `read_query` for `sentinel_findings` grouped by `kind` over the last 24h.
- Confirm the new fixtures generated the expected findings and that no regressions surfaced (e.g. `observability_coverage_gap` should be empty after task 6 wires the registry into a UI).
- File the counts as a `discussion_action` "Post-PR sentinel sweep — 2026-05-21".

### Out of scope (for this batch)

- Dropping any of the 37 empty tables (task 3 only catalogues + classifies; drops are a separate PR after operator review).
- Cross-project ingestion of out-of-scope items from Companion or Rork.
- New UI for editing observability_registry rows (read-only only).
- Rewriting the existing 100-fn observability baseline — additions only.

### Definition of done for the batch

- Tasks 1, 4, 7 have green tests in CI.
- Tasks 2, 3, 5, 9 have committed docs/memory updates.
- Task 6 has a working page at `/admin/observability-registry`.
- Task 8 has an applied skill.
- Task 10 sentinel sweep findings pasted into the closing action.
