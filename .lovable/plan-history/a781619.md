## Goal

When a plan we ship to the user lists "out of scope" items in its footer, those items should automatically land as `discussion_actions` rows so nothing falls on the floor. Today they're prose only — no DB evidence, no triage, no Morning Review presence.

## Approach

Capture out-of-scope items at two points:

1. **At plan-create time** — parse the plan body for an "Out of scope" / "Not in scope" / "Deferred" section and emit one `discussion_action` per bullet.
2. **At session-end time** — the `session-summary-log` endpoint already records outcomes; extend it to accept an `out_of_scope[]` array and fan-out the same way.

Both routes go through one shared writer so the contract is consistent.

## Steps

### 1. Migration — minimal schema additions

- Add `discussion_actions.source_kind` (text, nullable) — values: `plan_footer`, `session_summary`, `manual`, `morning_review`, etc. Default `manual` for back-compat.
- Add `discussion_actions.source_ref` (text, nullable) — e.g. `plan:<plan_id>` or `session:<session_id>`.
- Add partial unique index on `(source_kind, source_ref, title)` where `source_kind in ('plan_footer','session_summary')` — idempotency so re-parsing the same plan doesn't duplicate.
- Register the new writer in `observability_registry` (per the contract gate shipped earlier).

### 2. Shared writer — `_shared/out-of-scope.ts`

One function:

```ts
recordOutOfScope({
  items: string[],
  source_kind: 'plan_footer' | 'session_summary',
  source_ref: string,
  default_risk?: 'low' | 'medium' | 'high',
  workstream?: string,
}) → { created: string[], skipped: string[] }
```

- Inserts each item as a `discussion_action` with `status='open'`, `risk=default_risk ?? 'medium'`, `night_eligible=false` (operator decides), `source_kind`, `source_ref`.
- ON CONFLICT DO NOTHING via the partial unique index.
- Returns IDs so callers can echo them back to the operator.

### 3. New edge function — `plan-footer-ingest`

- POST `{ plan_id, plan_markdown }` — operator JWT or `x-awip-service-token`.
- Regex parses sections matching `^#{1,3}\s*(out\s*of\s*scope|not\s*in\s*scope|deferred|won't\s*do)\s*$` (case-insensitive) until next heading or EOF. Pulls `- ` / `* ` / numbered bullets.
- Calls `recordOutOfScope` with `source_kind='plan_footer'`, `source_ref='plan:<plan_id>'`.
- Returns `{ created, skipped, parsed_count }`.
- Wrapped with `withLogger`, declares `// @observability: plan_footer_ingest_failures`.

### 4. Extend `session-summary-log`

- Accept new optional field `out_of_scope: string[]`.
- After writing the summary row, call `recordOutOfScope` with `source_kind='session_summary'`, `source_ref='session:<summary_id>'`.
- Include the created action IDs in the response so the session-end checklist can show them.

### 5. UI surfaces (read-only, no new pages)

- `/morning-review` Discussion Actions panel already lists open actions — add a small `source_kind` badge ("from plan footer" / "from session end") so the operator can see where each came from.
- `session_summaries` detail view (existing) — show the linked out-of-scope action IDs as chips.

### 6. Sentinel check — `out_of_scope_stale`

- New check in `sentinel-tick`: if any `discussion_action` with `source_kind in ('plan_footer','session_summary')` is `status='open'` for >14 days → `medium` finding, grouped by `source_ref`. Forces the operator to either action or explicitly close gaps.

### 7. Docs + memory

- New: `docs/out-of-scope-autolog.md` — the contract, regex, idempotency rules, sentinel cadence.
- Update `docs/session-lifecycle.md` — session-end checklist now includes "list out-of-scope items".
- Update `AGENTS.md` working agreements — "Every plan with an out-of-scope footer MUST be POSTed to `plan-footer-ingest` before claiming done."
- Update `CHANGELOG.md`.
- Add `mem://features/out-of-scope-autolog` and reference it from `mem://index.md`.

### 8. Tests

- `supabase/functions/plan-footer-ingest/test.ts` — three fixtures:
  - Plan with H2 "Out of scope" + 3 bullets → 3 actions created.
  - Same plan re-posted → 0 created, 3 skipped.
  - Plan with no out-of-scope section → 0 created, no error.
- Unit test for the regex covering the four heading variants.
- Sentinel check test with a 15-day-old `plan_footer` action → asserts finding fires.

## Out of scope (for this PR)

- Auto-parsing plans already shipped historically — only new plans from this point forward.
- Editing UI for out-of-scope items inside the plan card.
- Cross-project (Companion / Rork) ingestion paths.

## Definition of done

- Migration applied, `rls:verify` green.
- `plan-footer-ingest` returns expected `{ created, skipped, parsed_count }` for all three fixtures.
- Posting a real plan creates rows visible at `/morning-review` with the new badge.
- `session-summary-log` smoke test creates linked actions.
- Sentinel check appears in registry and the test passes.
- Docs + CHANGELOG + memory updated.
