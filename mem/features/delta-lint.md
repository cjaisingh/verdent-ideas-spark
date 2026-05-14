---
name: delta-lint
description: Post-write delta lint (Hermes slice 2) — _shared/delta-lint helper + lint-delta edge function + sentinel + EdgeHealth surface
type: feature
---

Pre-response lint pass for code that edge functions are about to ship to the GitHub mirror. Imported from Hermes Agent v0.13.0 to kill the "edit → push → CI red → revert" loop.

## Helper: `supabase/functions/_shared/delta-lint.ts`

Pure async `lintDelta(files, { caller, requestId })`. Per file:

- `.ts` / `.tsx` → `deno check --no-lock --quiet` against a temp file, 5s timeout. Fail → `error_class = 'syntax' | 'type'`.
- `.json` → `JSON.parse`. Fail → `error_class = 'parse'`.
- `.md` / unknown → `status = 'skipped'`, no work.

Best-effort logs every file to `lint_delta_runs` via service-role client. **Never throws** — caller must inspect `results.some(r => r.status === 'failed')` itself.

## Endpoint: `lint-delta`

Thin HTTP wrapper, `withLogger`-wrapped. Auth: `x-awip-service-token` OR operator/admin JWT.

Body (1..25 files, path < 1024 chars, content < 200kB):
```json
{ "files": [{ "path": "x.ts", "content": "…" }], "caller": "companion-cloud-chat" }
```

Returns `{ ok, results }`. `ok = false` if any file failed.

## Schema

`public.lint_delta_runs` — operator-only RLS, realtime, 30-day retention. Columns: `caller`, `request_id`, `file_path`, `language`, `status` (`ok | failed | skipped | error`), `duration_ms`, `bytes`, `error_class`, `error_message`, `meta`.

## Sentinel

`lint_delta_failures` (medium, → high if >20/h) fires when >5 `failed` rows in last 60 min. Hourly dedupe key. Wired into `sentinel-tick` next to allowlist + whats-new checks.

## UI

`/admin/edge-health` → "Delta lint" card (top): 24h totals + recent failures table + click-row sheet with full `error_message` + `meta`. **"Lint sample" button** invokes `lint-delta` with one good + one bad TS file (operator probe). Realtime channel `edge-health-lint-${useId()}` filtered to `status=failed` triggers refresh.

## Wiring (deferred)

Calling `lintDelta` from `companion-cloud-chat` and `night-agent/open` before they respond is **out of scope for this slice** — needs response-shape work in each caller. The endpoint and infra are live; wiring is a follow-up job.

## Anti-patterns

- Calling `lintDelta` and ignoring the return value — always short-circuit on `failed`.
- Using it for `src/**` lint — that stays in the GH Actions pipeline.
- Adding ESLint/Prettier — `deno check` and `JSON.parse` only, on purpose.
- Lint runs > 25 files in one call — split, or use the GH Actions pipeline.
