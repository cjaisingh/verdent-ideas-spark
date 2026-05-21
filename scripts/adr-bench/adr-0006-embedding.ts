#!/usr/bin/env -S bun run
/**
 * ADR-0006 benchmark — embedding model + index revisit instrumentation.
 *
 * Runnable today. Read-only. Queries ai_usage_log for embedding spend +
 * counts rows in every table carrying an `embedding` column. Trips a
 * revisit recommendation if any threshold in docs/adr/benchmarks.md §
 * ADR-0006 is crossed.
 *
 * Usage:
 *   PGURL=postgresql://... bun run scripts/adr-bench/adr-0006-embedding.ts
 *
 * Falls back gracefully when PGURL is absent (CI / local without DB):
 * emits a zero-filled result so the harness stays exercised.
 */
import { z } from "zod";
import { hashDataset, writeBenchResult, uploadBenchResult, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  pgUrl: z.string().url().optional(),
  windowDays: z.number().int().min(1).max(90).default(30),
  sampleQueries: z.number().int().min(0).max(2000).default(200),
  topK: z.number().int().min(1).max(100).default(10),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "embedding_spend_eur_30d",
  "vector_row_count_max",
  "hnsw_query_p95_ms",
  "re_embed_jobs_30d",
] as const;

interface PgClient {
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

async function connect(pgUrl: string | undefined): Promise<PgClient | null> {
  if (!pgUrl) return null;
  try {
    // Dynamic import so the script still loads when `pg` is not installed.
    const mod = await import("pg").catch(() => null);
    if (!mod) return null;
    const { Client } = mod as { Client: new (cfg: { connectionString: string }) => PgClient };
    const c = new Client({ connectionString: pgUrl });
    await (c as unknown as { connect: () => Promise<void> }).connect();
    return c;
  } catch {
    return null;
  }
}

/**
 * Pick the p-th percentile (0–100) using nearest-rank on a sorted copy.
 */
export function percentile(samples: ReadonlyArray<number>, p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * HNSW (or whatever ANN index is attached to `embedding`) latency sampler.
 *
 * Strategy: for each table with ≥ MIN_ROWS embedding rows, pick a quota of
 * random `ctid`s proportional to its share of total rows (min 1, capped at
 * `totalQueries`). For each ctid we run a CTE that pulls the query vector
 * server-side — so we never serialise pgvector across the wire — and time
 * the `<->` top-K lookup with `performance.now()`. Returns p95(ms) across
 * all samples; 0 when nothing is sampleable.
 */
async function sampleHnswP95(
  client: PgClient,
  tables: ReadonlyArray<{ name: string; count: number }>,
  totalQueries: number,
  topK: number,
): Promise<number> {
  const MIN_ROWS = 20;
  const eligible = tables.filter((t) => t.count >= MIN_ROWS);
  if (eligible.length === 0 || totalQueries <= 0) return 0;
  const totalRows = eligible.reduce((s, t) => s + t.count, 0);

  const timings: number[] = [];
  for (const t of eligible) {
    const quota = Math.max(1, Math.round((t.count / totalRows) * totalQueries));
    const sample = await client.query<{ ctid: string }>(
      `select ctid::text as ctid
         from public.${t.name}
        where embedding is not null
        order by random()
        limit ${quota}`,
    );
    for (const row of sample.rows) {
      const start = performance.now();
      try {
        await client.query(
          `with q as (
             select embedding from public.${t.name} where ctid = '${row.ctid.replace(/'/g, "")}'::tid
           )
           select 1
             from public.${t.name} t, q
            where t.embedding is not null
            order by t.embedding <-> q.embedding
            limit ${topK}`,
        );
        timings.push(performance.now() - start);
      } catch {
        // Skip failed query (e.g. dimension mismatch); don't pollute timings.
      }
    }
  }
  return Math.round(percentile(timings, 95) * 100) / 100;
}



export async function run(input: Input): Promise<{ result: BenchResult; trips: string[] }> {
  const ranAt = new Date().toISOString();
  const client = await connect(input.pgUrl);
  const metrics: Record<string, number> = Object.fromEntries(
    METRIC_KEYS.map((k) => [k, 0]),
  );
  const sampledIds: string[] = [];

  if (client) {
    try {
      const spend = await client.query<{ s: string | null }>(
        `select coalesce(sum(cost_eur), 0)::text as s
         from public.ai_usage_log
         where created_at >= now() - interval '${input.windowDays} days'
           and (job ilike '%embed%' or job ilike '%embedding%')`,
      );
      metrics.embedding_spend_eur_30d = Number(spend.rows[0]?.s ?? 0);

      const reEmbed = await client.query<{ c: string | null }>(
        `select count(*)::text as c
         from public.ai_usage_log
         where created_at >= now() - interval '${input.windowDays} days'
           and job = 're-embed'`,
      );
      metrics.re_embed_jobs_30d = Number(reEmbed.rows[0]?.c ?? 0);

      const tables = await client.query<{ table_name: string }>(
        `select c.table_name
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.column_name = 'embedding'`,
      );
      const tableCounts: Array<{ name: string; count: number }> = [];
      for (const t of tables.rows) {
        const safe = t.table_name.replace(/[^a-zA-Z0-9_]/g, "");
        if (!safe) continue;
        sampledIds.push(safe);
        const r = await client.query<{ c: string | null }>(
          `select count(*)::text as c from public.${safe} where embedding is not null`,
        );
        const n = Number(r.rows[0]?.c ?? 0);
        tableCounts.push({ name: safe, count: n });
      }
      metrics.vector_row_count_max = tableCounts.reduce((m, t) => Math.max(m, t.count), 0);
      metrics.hnsw_query_p95_ms = await sampleHnswP95(client, tableCounts, input.sampleQueries, input.topK);
    } finally {
      await client.end();
    }
  }

  const result: BenchResult = {
    adr: "adr-0006",
    ran_at: ranAt,
    dataset_hash: hashDataset(sampledIds.length ? sampledIds : ["empty"]),
    metrics,
    notes: client
      ? "live DB sample"
      : "no PGURL or pg driver — zero-filled result; harness wiring verified",
  };

  const trips: string[] = [];
  if (metrics.embedding_spend_eur_30d > 50) trips.push("spend>€50/30d");
  if (metrics.vector_row_count_max > 1_000_000) trips.push("rows>1M");
  if (trips.length) result.notes = `REVISIT ADR-0006: ${trips.join(", ")}`;

  return { result, trips };
}

if (import.meta.main) {
  const input = InputSchema.parse({
    pgUrl: process.env.PGURL,
    windowDays: process.env.WINDOW_DAYS ? Number(process.env.WINDOW_DAYS) : undefined,
    sampleQueries: process.env.SAMPLE_QUERIES ? Number(process.env.SAMPLE_QUERIES) : undefined,
    topK: process.env.TOP_K ? Number(process.env.TOP_K) : undefined,
  });
  const { result, trips } = await run(input);
  const path = writeBenchResult(result);
  const upload = await uploadBenchResult(result, trips);
  console.log(JSON.stringify({ wrote: path, upload, result }, null, 2));
}
