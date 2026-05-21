## Next 10 tasks — validated 2026-05-21 (post-session)

**State checked before drafting (live read):**
- `sentinel_findings` open: **1 high** — `edge_function_error_rate` on `session-summary-log` (3 of 4 calls = 75% 5xx in last 30m, finding `afb5a70d`). Likely tail of the bug I patched earlier this session; need to confirm fresh calls succeed before closing.
- `discussion_actions` open/in_progress: **17** — 3 ADR benches (blocked on Phase 5 tables), 7 newly auto-logged session-summary follow-ups, 4 plan_footer rows from autologger PR, 1 sentinel-sweep close-out, 1 companion-origin smoke artefact, 1 low-pri any-ratchet.
- New blockers discovered last batch: Morning Review badge needs aggregator SQL extension (not pure UI); backfill script ready but no `.lovable/plan-history/` dir yet.

Tasks sequential. Each ends with the verification step that closes its named row.

---

### 1. Verify `session-summary-log` is actually healthy and close finding `afb5a70d`
- `curl_edge_functions` POST `/session-summary-log` with a minimal valid payload (the schema my last patch fixed).
- `analytics_query` last 30m of `function_edge_logs` for `session-summary-log` to confirm 200s and no new 5xx.
- If green: mark finding `afb5a70d` resolved with the verification ref. If still failing: tail `edge_function_logs`, fix, redeploy — do not proceed to task 2 until clean.
- **Verify**: finding row `status='resolved'`; new 200 in logs within 5m.

### 2. Wire `morning-review` aggregator to project `source` + ship Morning Review badge
- Read `supabase/functions/morning-review/index.ts` (or the SQL view it queries) and add `source`, `source_ref` to the Discussion Actions panel projection.
- Add colour-coded chip in `src/pages/MorningReview.tsx` (`plan_footer`=blue, `session_summary`=amber, `manual`=slate, `extracted`=violet), hover shows `source_ref`.
- **Verify**: /morning-review renders chips against real rows (auto-logged ones are visible in current data). Close `2b76b040` **and** `fe2a3165`.

### 3. Create `.lovable/plan-history/` + seed it + run backfill
- `mkdir .lovable/plan-history`; copy current `.lovable/plan.md` snapshots from recent git log (last 5 distinct versions) as `plan-history/<YYYY-MM-DD>-<slug>.md`.
- Run `scripts/backfill-plan-footers.ts` (already in repo) with `AWIP_SERVICE_TOKEN`.
- **Verify**: `read_query` `select count(*) from discussion_actions where source='plan_footer' and source_ref like 'plan:%'` increases; close `d96f5e71` **and** `0056fcc1`.

### 4. Wire `copilot_lessons` producer
- `rg "copilot_lessons"` — confirm read site, then add producer step at end of `lessons-synthesize` that fans high-confidence (`confidence >= 0.8`) rows from `lessons` into `copilot_lessons` keyed by persona slug, idempotent on `(persona, lesson_id)`.
- Add `copilot_lessons_silent` sentinel check (medium, ≥14d absent when `lessons` non-empty).
- **Verify**: manually invoke `lessons-synthesize`, `read_query` shows ≥1 row in `copilot_lessons`. Close `794e714e`.

### 5. Wire `lint_delta_runs` CI step
- Edit `.github/workflows/lint-and-typecheck.yml`: after lint passes on PR, `curl` `lint-delta` edge fn with the PR diff (or changed file list), capture returned `run_id`, surface as GH Actions annotation.
- Use `AWIP_SERVICE_TOKEN` from repo secret.
- **Verify**: push a no-op PR branch, confirm row lands in `lint_delta_runs`. Close `84b26cb8`.

### 6. Repair `frontend_error_logs` beacon
- Read `src/lib/frontend-error-capture.ts` and confirm mounted in `src/main.tsx`.
- Check `supabase/functions/client-error-beacon/index.ts` CORS + auth (anon-allowed? service-token-only?). 0 rows in 14d ⇒ almost certainly auth/CORS rejection — pull last 50 `function_edge_logs` for the beacon function to confirm.
- Fix the path, throw a synthetic error from preview.
- **Verify**: row in `frontend_error_logs` within 60s. Close `446e77c1`.

### 7. Smoke `plan-footer-ingest origin='rork'` + document in `docs/rork-companion-spec.md`
- `curl_edge_functions` POST with `origin: 'rork'`, a unique `plan_id`, and a 1-item synthetic plan markdown.
- Confirm `source_ref` is `plan:rork:<id>` and dedupe holds on re-POST.
- Append a "Cross-project ingest" section to `docs/rork-companion-spec.md` with the contract + example.
- **Verify**: row in `discussion_actions` with the rork source_ref. Close `fce60fbd`. Also resolve the leftover smoke artefact `cf50227f` if it's redundant.

### 8. Drop-candidate cleanup migration (7 dead tables)
- Migration drops: `agent_onboarding_sessions`, `capability_connectors`, `connection_audit_log`, `deferred_items`, `lessons_backfill_runs`, `rethink_tasks`, `roadmap_autolog_skips`. Each verified writer-less in the 2026-05-21 audit.
- Update `docs/empty-tables-audit-2026-05-21.md` with strike-through and "dropped 2026-05-21" timestamp.
- **Verify**: `bun run rls:verify` still green; `read_query` `information_schema.tables` confirms gone.

### 9. Mark ADR-bench rows blocked-not-open (don't pretend they're actionable)
- The 3 ADR benches (`eda8177d`, `92c899c0`, `79063057`) and their 3 session-summary duplicates (`e959a662`, `7f20bd69`, `888fe7aa`) all block on Phase 5 tables. Keeping them `open` distorts the inbox.
- Add a `blocked` status path: either (a) move to `status='blocked'` with `blocked_reason='phase-5-tables-not-implemented'`, or (b) attach a `blockers` array via a `discussion_action_note`. Pick whichever already exists in schema (`read_query` `pg_enum` for `discussion_action_status`).
- **Verify**: 6 rows leave the open-actions feed on /morning-review.

### 10. Close-out sentinel sweep + session summary
- `curl_edge_functions` `sentinel-tick`; `read_query` open `sentinel_findings` grouped by kind+severity for last 24h.
- Close `71ea2780` with the counts table.
- POST `session-summary-log` with this batch's `out_of_scope`, `files_touched`, `migrations_applied`.
- Update `CHANGELOG.md` with one consolidated 2026-05-21 batch-2 block.

---

### Out of scope (auto-logged at session end)
- Wiring `roadmap_task_checklist` / `_evidence` / `_reviews` — needs UI scoping first.
- Replacing the ~480 `no-explicit-any` usages (`ee7937ce`, low pri).
- New sentinel rules beyond `copilot_lessons_silent`.
- Building a `.lovable/plan-history/` automation (manual seed in task 3 is enough for now).

### Definition of done
- Tasks 1, 4–7 each close their named row(s); task 2 closes 2 rows; task 3 closes 2 rows; task 9 reclassifies 6 rows; task 10 leaves `sentinel_findings` clean and posts a summary.
- `mem/index.md` updated **only** if task 8 (drops) or task 9 (status enum change) introduces a durable rule.
- One CHANGELOG entry, not ten.

### Risk notes
- Task 1 is a real fire; if it stays red, tasks 3/7/10 (all of which POST to `session-summary-log`) will keep flaring the same finding. Do it first.
- Task 8 is the only destructive task — migration only, no code refs to remove (already verified writer-less).
- Task 5 touches CI; confirm `AWIP_SERVICE_TOKEN` exists as a GH Actions secret before pushing the workflow change.
