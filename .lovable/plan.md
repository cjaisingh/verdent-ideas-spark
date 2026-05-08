## Goal

Break `supabase/functions/night-agent/index.ts` (612 lines, mixed concerns) into small, single-purpose sibling modules so a stray brace or a change to filter parsing can no longer take the whole function down. No behaviour changes — pure refactor.

Pattern follows what `db-explorer/` already does (sibling `audit.ts` + `audit_test.ts` next to `index.ts`), so the existing "no subfolders" guideline still holds.

## Target file layout

```text
supabase/functions/night-agent/
  index.ts          — Deno.serve, auth, routing only (~90 lines)
  config.ts         — env, constants, NightSettings type, corsHeaders, json()
  time.ts           — localParts(), inWindow()
  classify.ts       — classifyJob(), inferPhaseAndSuite(), SEV_RANK, worse()
  filters.ts        — parseOpenTestFilters(url) → { phaseFilter, riskFilter, verdictFilter, titleQuery, shortNums, limit, filtersApplied }
  gates.ts          — evaluateOpenGates() (admin test-mode handler)
  open.ts           — openShift()
  close.ts          — closeShift()
  smoke.ts          — smokeTest()
  open_test_mode_test.ts — unchanged (already imports nothing from index)
```

## What moves where

- **config.ts** — `corsHeaders`, `SUPABASE_URL`, `SERVICE_ROLE`, `SERVICE_TOKEN`, `MAX_JOBS_PER_SHIFT`, `json()`, exported `NightSettings` type, shared `createServiceClient()` helper.
- **time.ts** — `localParts(now, tz)` and `inWindow(hhmm, start, end)`. Pure, no deps.
- **classify.ts** — `SEV_RANK`, `worse()`, `classifyJob()`, `inferPhaseAndSuite()`. Pure.
- **filters.ts** — extract the CSV/limit/q/short_num parsing block currently inlined in `evaluateOpenGates` (lines 504–516, 553–560) into one `parseOpenTestFilters(url)` function returning both the runtime sets and the `filters_applied` echo object. Also exposes a pure `applyDerivedFilters(classified, f)` for the in-memory phase/risk/verdict pass.
- **gates.ts** — `evaluateOpenGates()` using `time`, `classify`, `filters`, `config`. The audit-log insert stays here (it's the gate-verification side-effect).
- **open.ts / close.ts / smoke.ts** — current `openShift` / `closeShift` / `smokeTest` bodies, importing helpers from `time`, `classify`, `config`.
- **index.ts** — only: imports, `Deno.serve`, OPTIONS, auth check, settings fetch, route dispatch (`/open?test=1` → gates, `/open` → open, `/close` → close, `/smoke` → smoke), top-level try/catch.

## Approach

1. Create the new sibling modules with the extracted code (copy, don't rewrite — keep identical logic, comments, and error messages).
2. Rewrite `index.ts` to import from them; preserve the exact public HTTP contract (paths, status codes, response shapes, audit-log row).
3. Verify by:
   - reading the new `index.ts` end-to-end,
   - running `supabase--test_edge_functions` against `night-agent` (the existing Deno test mirrors gate logic and doesn't import from index, so it should still pass),
   - deploying via `supabase--deploy_edge_functions ["night-agent"]` and confirming no parse error.

## Non-goals

- No change to request/response shapes.
- No change to RLS, audit-log scope/keys, or the `discussion_actions` query.
- No change to `open_test_mode_test.ts`.
- Not touching `AutomationPanel.tsx`, `NightAgentTestModeCard.tsx`, or any frontend.

## Risks & mitigations

- **Edge-function bundler dislikes sibling imports** — already proven safe by `db-explorer/audit.ts`. Use relative `./time.ts` imports with explicit `.ts` extension (Deno convention).
- **Hidden coupling between handlers** — none found; `openShift`, `closeShift`, `smokeTest`, `evaluateOpenGates` only share the small helpers being extracted.
- **Audit-log behaviour drift** — the entire insert block moves verbatim into `gates.ts`; verified by the existing test asserting 200 + gate consistency.
