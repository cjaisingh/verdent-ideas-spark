## Goal

Get a real ADR-0006 bench result into `bench-results/` and `adr_bench_results` so `/admin/adr-bench` shows a baseline and the revisit triggers start counting from a known zero.

## What the probe just found

- `ai_usage_log.cost_eur` **does not exist** — the column is `cost_usd`. The current `scripts/adr-bench/adr-0006-embedding.ts` would error on its first query.
- No `public.*` table has an `embedding` column yet (Phase 6 hasn't shipped, `awip_doc_chunks` isn't vectorised). So `vector_row_count_max` and `hnsw_query_p95_ms` are genuinely 0.
- 0 embedding calls in `ai_usage_log` over the last 30d.
- `pg` driver isn't installed in the sandbox; the script's `connect()` would silently return `null` and zero-fill anyway.
- `PGHOST`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are all present, so a `psql` or REST-based variant can run today.

Net: running the bench *as-is* writes a misleading zero result whose only meaningful number (spend) is actually a swallowed crash. Worth a 15-min fix before pressing go.

## Steps

1. **Patch the bench script** (`scripts/adr-bench/adr-0006-embedding.ts`):
   - `cost_eur` → `cost_usd` in the spend query.
   - Rename the metric key `embedding_spend_eur_30d` → `embedding_spend_usd_30d` (and update `METRIC_KEYS`).
   - Drop the `pg` dependency. Use `fetch` against `${SUPABASE_URL}/rest/v1/rpc/...` or a tiny pair of `psql -c` shellouts via `Deno.Command`/`Bun.spawn` — same shape as other scripts in the repo. (Pick whichever matches `_shared.ts` conventions; if neither, prefer REST since service-role key is already wired.)

2. **Update `docs/adr/benchmarks.md § ADR-0006`**:
   - Threshold `embedding_spend_eur_30d > 50` → `embedding_spend_usd_30d > 50` (keep the €50 *intent* in prose; the metric is whatever currency `ai_usage_log` actually stores).
   - Note that until any table grows an `embedding` column, `vector_row_count_max` / `hnsw_query_p95_ms` are structurally 0, not "no data".

3. **Patch ADR-0006**: one-line correction in the Revisit trigger and Measurement harness pointer so they match the column reality.

4. **Run the bench** and capture the JSON to `bench-results/adr-0006-<stamp>.json`. Upload via `uploadBenchResult()` so it shows on `/admin/adr-bench`.

5. **Paste the (zero-baseline) numbers** into ADR-0006 Consequences as the first data point, with a note that this is the pre-Phase-6 baseline. CHANGELOG entry under `### Measured`.

6. **Memory**: add a one-liner to `mem/features/adr-bench-history.md` (file already exists) recording the baseline + the `cost_eur`→`cost_usd` fix so the next bench author doesn't re-trip it.

## Out of scope

- ADR-0003 / 0004 / 0005 — gated by Phase 5/6 data that doesn't exist yet.
- Wiring the bench into a cron. Once Phase 6 ships a vector store, schedule a weekly run; not before.
- Switching from USD to EUR in `ai_usage_log` — separate accounting decision.

## Verification

- `bun run scripts/adr-bench/adr-0006-embedding.ts` exits 0 with a non-zero `spend_usd_30d` query (even if value is `0`) and writes a result file.
- `select * from public.adr_bench_results where adr='adr-0006' order by ran_at desc limit 1;` returns the new row.
- `/admin/adr-bench` shows the row in the UI.

## Technical notes

- Service-role insert path already works (`adr_bench_results` RLS permits service role); no migration needed.
- The script currently swallows pg errors silently via `catch {}` inside `connect()` but NOT inside `run()` — that's how `cost_eur` would have crashed the run rather than zeroing the metric. Worth keeping the un-caught path so future schema drift is loud.
