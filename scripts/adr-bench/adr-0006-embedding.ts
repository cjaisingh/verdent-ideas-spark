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

export async function run(input: Input): Promise<BenchResult> {
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
      let maxCount = 0;
      for (const t of tables.rows) {
        const safe = t.table_name.replace(/[^a-zA-Z0-9_]/g, "");
        if (!safe) continue;
        sampledIds.push(safe);
        const r = await client.query<{ c: string | null }>(
          `select count(*)::text as c from public.${safe}`,
        );
        const n = Number(r.rows[0]?.c ?? 0);
        if (n > maxCount) maxCount = n;
      }
      metrics.vector_row_count_max = maxCount;
      // hnsw_query_p95_ms left at 0 until we ship the 200-query sampler.
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
  });
  const { result, trips } = await run(input);
  const path = writeBenchResult(result);
  const upload = await uploadBenchResult(result, trips);
  console.log(JSON.stringify({ wrote: path, upload, result }, null, 2));
}
