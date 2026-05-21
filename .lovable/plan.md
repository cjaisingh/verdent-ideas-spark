## Next 10 tasks — validated 2026-05-21

State checked before drafting:
- `sentinel_findings`: **0 open** (64 resolved). No live fires to chase.
- `discussion_actions` open: **7 med + 1 low** — 3 ADR benches, 3 plan_footer follow-ups from the autologger PR, 1 sentinel-sweep close-out, 1 any-ratchet cleanup.
- `docs/empty-tables-audit-2026-05-21.md` flagged 6 `wire-up` tables + 7 `drop-candidate`. Only `telegram_send_log` has been fixed so far.
- Previous batch (10 tasks ending Task 10) shipped; CHANGELOG + memory in sync.

Tasks are sequential. Each ends with the verification step that closes its row in `discussion_actions`.

---

### 1. Run ADR-0003 bench + commit Consequences
- Execute `bun run scripts/adr-bench/adr-0003-ancestry.ts` against the live DB.
- Pipe results through `scripts/adr-bench/format-consequences.ts`.
- Patch the Consequences section of `docs/adr/0003-tenant-node-ancestry-storage.md` with numbers + run date.
- **Verify**: row appended to `adr_bench_runs`; close `discussion_action eda8177d`.

### 2. Run ADR-0004 bench (alias revocation cascade)
- Same flow with `adr-0004-revocation.ts`, target doc `docs/adr/0004-alias-revocation-cascade.md`.
- **Verify**: close `discussion_action 92c899c0`.

### 3. Run ADR-0005 bench (bulk conflict pattern detection)
- Same flow with `adr-0005-bulk-conflicts.ts`, target doc `docs/adr/0005-bulk-conflict-pattern-detection.md`.
- **Verify**: close `discussion_action 79063057`.

### 4. UI source-badge on Morning Review Discussion Actions panel
- Add a small chip next to each row showing `source` (`plan_footer` / `session_summary` / `manual` / `extracted`) — colour-coded, hover shows `source_ref`.
- Touch only `src/pages/MorningReview.tsx` (or the panel component it imports). No business logic changes.
- **Verify**: route loads at /morning-review with badges visible; close `discussion_action 2b76b040`.

### 5. Backfill historical plans into `discussion_actions`
- One-shot script `scripts/backfill-plan-footers.ts`: walks `.lovable/plan-history/*.md` (or git-log of `.lovable/plan.md`), parses the "Out of scope" footer with the shared `parseOutOfScope`, POSTs each to `plan-footer-ingest` with `plan_id = <commit-sha>`.
- Idempotent by design (autologger dedupes on `source_ref`).
- **Verify**: `read_query` count of `discussion_actions` where `source='plan_footer'` jumps; close `discussion_action 0056fcc1`.

### 6. Cross-project ingest path (Companion / Rork)
- Extend `plan-footer-ingest` to accept `origin: 'companion' | 'rork' | 'core'` and stamp it onto `source_ref` as `plan:<origin>:<id>`.
- Document in `docs/out-of-scope-autolog.md` + `docs/rork-companion-spec.md`.
- No Rork client changes — contract only, Rork picks it up next pass.
- **Verify**: smoke via `curl_edge_functions` with `origin: 'companion'`; close `discussion_action fce60fbd`.

### 7. Wire up `copilot_lessons` (empty-tables audit)
- Find the read site (`grep` for `from('copilot_lessons')`).
- Add the producer — likely a step in `lessons-synthesize` that fans high-confidence lessons into `copilot_lessons` keyed by persona.
- Add a sentinel check `copilot_lessons_silent` if absent ≥14d (only if `lessons` is non-empty).
- **Verify**: row in `copilot_lessons` after manual `lessons-synthesize` invoke.

### 8. Wire up `lint_delta_runs`
- `lint-delta` edge fn exists; nothing calls it. Add a CI step in `.github/workflows/lint-and-typecheck.yml` that POSTs the PR diff to `lint-delta` and surfaces the row id as a check annotation.
- **Verify**: row appears in `lint_delta_runs` after a synthetic PR; `lint_delta_failures` sentinel still green.

### 9. Wire up `frontend_error_logs`
- `src/lib/frontend-error-capture.ts` exists; confirm it's mounted in `src/main.tsx` and posting to a working endpoint (likely `client-error-beacon`).
- 0 rows in 14d almost certainly means the beacon path is broken — likely a CORS or auth header regression.
- Fix + add one synthetic error to confirm round-trip.
- **Verify**: row in `frontend_error_logs` within 60s of throwing in the preview.

### 10. Close-out sentinel sweep
- Manually invoke `sentinel-tick`.
- `read_query` open `sentinel_findings` last 24h, grouped by kind.
- Close `discussion_action 71ea2780` (Post-PR sentinel sweep) with the counts.
- POST `session-summary-log` for this batch with `out_of_scope: [drop-candidate cleanup PR, roadmap_task_* wire-up, any-ratchet cleanup]`.

---

### Out of scope (auto-logged at session end)
- Dropping the 7 `drop-candidate` tables — separate PR after operator review.
- Wiring `roadmap_task_checklist` / `_evidence` / `_reviews` — needs UI scoping first.
- Replacing the ~480 `no-explicit-any` usages (action `ee7937ce`, low priority).
- Any new sentinel rules beyond `copilot_lessons_silent`.

### Definition of done
- Tasks 1–3, 5–9 each close their named `discussion_action`.
- Task 4 ships a visible badge at /morning-review.
- Task 10 leaves `sentinel_findings` clean and posts the session summary.
- CHANGELOG + `mem/index.md` updated only if a durable rule changes (none expected).