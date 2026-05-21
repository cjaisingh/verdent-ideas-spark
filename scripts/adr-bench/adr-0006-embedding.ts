#!/usr/bin/env -S bun run
/**
 * ADR-0006 benchmark — embedding model + index revisit instrumentation.
 *
 * Read-only. Queries ai_usage_log for embedding spend + counts rows in every
 * table carrying an `embedding` column. Trips a revisit recommendation if any
 * threshold in docs/adr/benchmarks.md § ADR-0006 is crossed.
 *
 * Usage:
 *   psql via PG* env (PGHOST/PGUSER/PGDATABASE/...) — same as the rest of the
 *   sandbox. Falls back to a zero-filled result when psql is unreachable so the
 *   harness stays exercised.
 */
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { hashDataset, writeBenchResult, uploadBenchResult, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  windowDays: z.number().int().min(1).max(90).default(30),
  sampleQueries: z.number().int().min(0).max(2000).default(200),
  topK: z.number().int().min(1).max(100).default(10),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "embedding_spend_usd_30d",
  "vector_row_count_max",
  "hnsw_query_p95_ms",
  "re_embed_jobs_30d",
] as const;

function psqlAvailable(): boolean {
  try {
    execFileSync("psql", ["-c", "select 1"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function psqlScalar(sql: string): string {
  // -tA: tuples only, unaligned. Returns one value per line.
  const out = execFileSync("psql", ["-tA", "-c", sql], { encoding: "utf8" });
  return out.trim();
}

function psqlLines(sql: string): string[] {
  const out = execFileSync("psql", ["-tA", "-c", sql], { encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function percentile(samples: ReadonlyArray<number>, p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function sampleHnswP95(
  tables: ReadonlyArray<{ name: string; count: number }>,
  totalQueries: number,
  topK: number,
): number {
  const MIN_ROWS = 20;
  const eligible = tables.filter((t) => t.count >= MIN_ROWS);
  if (eligible.length === 0 || totalQueries <= 0) return 0;
  const totalRows = eligible.reduce((s, t) => s + t.count, 0);

  const timings: number[] = [];
  for (const t of eligible) {
    const quota = Math.max(1, Math.round((t.count / totalRows) * totalQueries));
    const ctids = psqlLines(
      `select ctid::text from public.${t.name} where embedding is not null order by random() limit ${quota}`,
    );
    for (const ctid of ctids) {
      const safe = ctid.replace(/'/g, "");
      const start = performance.now();
      try {
        execFileSync(
          "psql",
          [
            "-tA",
            "-c",
            `with q as (select embedding from public.${t.name} where ctid = '${safe}'::tid) select 1 from public.${t.name} t, q where t.embedding is not null order by t.embedding <-> q.embedding limit ${topK}`,
          ],
          { stdio: ["ignore", "ignore", "ignore"] },
        );
        timings.push(performance.now() - start);
      } catch {
        // dimension mismatch / no operator — skip.
      }
    }
  }
  return Math.round(percentile(timings, 95) * 100) / 100;
}

export async function run(input: Input): Promise<{ result: BenchResult; trips: string[] }> {
  const ranAt = new Date().toISOString();
  const metrics: Record<string, number> = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));
  const sampledIds: string[] = [];
  const havePsql = psqlAvailable();

  if (havePsql) {
    metrics.embedding_spend_usd_30d = Number(
      psqlScalar(
        `select coalesce(sum(cost_usd), 0)::text from public.ai_usage_log where created_at >= now() - interval '${input.windowDays} days' and (job ilike '%embed%' or job ilike '%embedding%')`,
      ) || 0,
    );
    metrics.re_embed_jobs_30d = Number(
      psqlScalar(
        `select count(*)::text from public.ai_usage_log where created_at >= now() - interval '${input.windowDays} days' and job = 're-embed'`,
      ) || 0,
    );
    const tableNames = psqlLines(
      `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'embedding'`,
    );
    const tableCounts: Array<{ name: string; count: number }> = [];
    for (const raw of tableNames) {
      const safe = raw.replace(/[^a-zA-Z0-9_]/g, "");
      if (!safe) continue;
      sampledIds.push(safe);
      const n = Number(
        psqlScalar(`select count(*)::text from public.${safe} where embedding is not null`) || 0,
      );
      tableCounts.push({ name: safe, count: n });
    }
    metrics.vector_row_count_max = tableCounts.reduce((m, t) => Math.max(m, t.count), 0);
    metrics.hnsw_query_p95_ms = sampleHnswP95(tableCounts, input.sampleQueries, input.topK);
  }

  const result: BenchResult = {
    adr: "adr-0006",
    ran_at: ranAt,
    dataset_hash: hashDataset(sampledIds.length ? sampledIds : ["empty"]),
    metrics,
    notes: havePsql
      ? sampledIds.length
        ? "live DB sample"
        : "live DB sample — no vector tables exist yet (pre-Phase-6 baseline)"
      : "no psql — zero-filled result; harness wiring verified",
  };

  const trips: string[] = [];
  if (metrics.embedding_spend_usd_30d > 50) trips.push("spend>$50/30d");
  if (metrics.vector_row_count_max > 1_000_000) trips.push("rows>1M");
  if (trips.length) result.notes = `REVISIT ADR-0006: ${trips.join(", ")}`;

  return { result, trips };
}

if (import.meta.main) {
  const input = InputSchema.parse({
    windowDays: process.env.WINDOW_DAYS ? Number(process.env.WINDOW_DAYS) : undefined,
    sampleQueries: process.env.SAMPLE_QUERIES ? Number(process.env.SAMPLE_QUERIES) : undefined,
    topK: process.env.TOP_K ? Number(process.env.TOP_K) : undefined,
  });
  const { result, trips } = await run(input);
  const path = writeBenchResult(result);
  const upload = await uploadBenchResult(result, trips);
  console.log(JSON.stringify({ wrote: path, upload, result }, null, 2));
}
