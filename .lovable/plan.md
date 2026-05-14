Slice 2 of the Hermes import: a delta-lint that runs `deno check` / JSON parse on changed files **inside the edge-function tool call**, before the response goes out — so syntax/type breakage never reaches the GitHub mirror.

This is server-side infrastructure with a thin admin surface. No "who acts when" routing — Core just records the lint events.

## Schema (1 migration)

New table `lint_delta_runs`:

| column | type | note |
|---|---|---|
| `id` | uuid pk | |
| `created_at` | timestamptz default now() | |
| `caller` | text | edge function name that requested the lint |
| `request_id` | text | from `x-request-id` so we can join `edge_request_logs` |
| `file_path` | text | repo-relative |
| `language` | text | `ts` \| `tsx` \| `json` \| `md` \| `other` |
| `status` | text | `ok` \| `failed` \| `skipped` \| `error` |
| `duration_ms` | int | |
| `bytes` | int | size of the input |
| `error_class` | text null | `syntax` \| `type` \| `parse` \| `timeout` \| `runtime` |
| `error_message` | text null | first 500 chars |
| `meta` | jsonb default `{}` | exit code, command, etc |

Operator-only RLS, realtime on, retention via `retention_settings` (30 days).

Indexes: `(created_at desc)`, `(caller, created_at desc)`, `(status, created_at desc)`.

## Shared module: `supabase/functions/_shared/delta-lint.ts`

Pure helper, no HTTP. Exports `lintDelta(files: { path: string; content: string }[], opts?: { caller?: string; requestId?: string }) → Promise<LintResult[]>`.

Per file:
- `.ts` / `.tsx` → write to `Deno.makeTempFile`, run `deno check --no-lock --quiet <tmp>` with 5s timeout. Parse stderr → `error_class = 'type' | 'syntax'`.
- `.json` → `JSON.parse`. Failure → `error_class = 'parse'`.
- `.md` / unknown → `status = 'skipped'`, no work.

After each file, insert a row into `lint_delta_runs` (best-effort, never throws). Returns array so callers can short-circuit.

## Edge function: `supabase/functions/lint-delta/index.ts`

Thin HTTP wrapper around the shared helper. Wrapped with `withLogger`. Accepts service token OR operator JWT.

Body schema (Zod):
```ts
{ files: [{ path: string, content: string }], caller?: string }
```

Returns `{ ok: boolean, results: LintResult[] }`. `ok = false` if any file failed. CORS enabled.

Default-deny gate is N/A here — this is internal-only, gated by service token / operator JWT.

## Wiring

The two existing edge paths that write generated code are:
- `companion-cloud-chat` (when it returns code blocks the client writes)
- `night-agent/open` (when audits suggest patches)

For this slice we only **expose** the helper + endpoint and add the admin UI. Wiring those two callers to actually call `lintDelta` before responding is a follow-up note in `.lovable/plan.md` — not in scope, since they need their own response-shape changes.

## Sentinel check

New finding `lint_delta_failures` (medium): fires when `lint_delta_runs` has >5 `failed` rows in the last 60 minutes. Wired into `sentinel-tick/checks.ts` next to the existing edge-health checks. Not auto-promoted.

## Admin UI: `/admin/edge-health` (extend, don't add a new route)

- New "Delta Lint" card at the top of the page showing 24h totals: `total / failed / skipped`, plus `lint_delta_failures` 24h count + last failure summary.
- New "Recent failures" table beneath the existing edge-health table: `created_at`, `caller`, `file_path`, `error_class`, `error_message` (truncated), `duration_ms`. Click row → side panel with full message and meta JSON.
- Realtime subscription on `lint_delta_runs` filtered to `status=failed`.

No new sidebar entry; this lives inside the existing Edge Function Health page.

## Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_lint_delta_runs.sql` | new — table + RLS + indexes + retention row |
| `supabase/functions/_shared/delta-lint.ts` | new — pure helper |
| `supabase/functions/lint-delta/index.ts` | new — HTTP endpoint, `withLogger`-wrapped |
| `supabase/functions/sentinel-tick/checks.ts` | edit — add `lint_delta_failures` check |
| `supabase/functions/sentinel-tick/index.ts` | edit — call new check |
| `src/pages/EdgeHealth.tsx` | edit — add Delta Lint card + failures table + realtime |
| `src/components/admin/DeltaLintCard.tsx` | new — small dashboard card |
| `src/components/admin/DeltaLintFailures.tsx` | new — table + side panel |
| `mem/features/delta-lint.md` | new — feature memory |
| `mem/index.md` | edit — append memory link |
| `CHANGELOG.md` | edit — Hermes slice 2 entry |
| `docs/automation.md` (if present) | edit — note new sentinel check |

## Out of scope

- Wiring `companion-cloud-chat` and `night-agent/open` to actually call `lintDelta` before responding — separate slice (needs response-shape work in each caller).
- Auto-revert of failing edits — this is a tripwire, not a guard.
- ESLint / Prettier — `deno check` and `JSON.parse` only.
- Lint of non-edge code (`src/**`) — that stays in the GH Actions pipeline.
- Slice 3 (companion session auto-resume) — separate ship.

## Verification

- `supabase--migration` for the new table.
- `supabase--test_edge_functions` against `lint-delta` with a known-good `.ts` file (expect `ok=true`) and a deliberately broken one (expect `ok=false`, `error_class='syntax'`).
- Open `/admin/edge-health`, hit "Lint sample" button (operator-only) → row appears in real time.
- Sentinel: insert 6 failed rows via service token, wait one tick, confirm `sentinel_findings` row.