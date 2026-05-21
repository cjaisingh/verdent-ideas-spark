---
name: ADR bench history
description: Operator page at /admin/adr-bench listing scripts/adr-bench/* runs by ADR with metrics and revisit-trigger status
type: feature
---

`/admin/adr-bench` (`src/pages/AdminAdrBench.tsx`) is the operator-only viewer
for ADR benchmark runs. Source of truth for thresholds: `docs/adr/benchmarks.md`.

- **Table:** `public.adr_bench_results` — operator-only RLS, realtime on.
  Columns: `adr`, `ran_at`, `dataset_hash`, `metrics jsonb`, `notes`,
  `tripped_triggers text[]`, `source` (`script` | `manual`).
- **Ingest:** `scripts/adr-bench/_shared.ts → uploadBenchResult()` POSTs to
  `/rest/v1/adr_bench_results` with service role key when `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set. Silent no-op otherwise — file write
  still happens.
- **Status logic:** `src/lib/adr-bench-thresholds.ts` mirrors benchmarks.md
  per-ADR thresholds → `green` / `watch` / `revisit`. Keep both in sync in the
  same PR. Page also displays `tripped_triggers` recorded by the script.
- **Wired scripts:** `adr-0006-embedding.ts` uploads on every run.
  `adr-0003/0004/0005` throw before upload (tables not yet in place).
