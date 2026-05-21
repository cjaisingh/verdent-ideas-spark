#!/usr/bin/env -S bun run
/**
 * ADR-0003 benchmark — tenant-node ancestry storage.
 *
 * Measures the chosen lean (denormalised `ancestry_ids uuid[]` + GIN on
 * `tenant_nodes`) against the real `tenant_nodes` table. Pre-import
 * (node_count < benchmarks.md trigger of 5k) the script still runs and
 * captures structural metrics (index_bytes / column_bytes / row count)
 * so the harness wiring stays verified — mirrors the ADR-0006 baseline
 * pattern. Latency metrics stay 0 until a real tenant tree lands; the
 * ADR-0003 status flip is gated on that, not on this script alone.
 *
 * See docs/adr/benchmarks.md § ADR-0003 for thresholds.
 *
 * Usage:
 *   psql via PG* env (PGHOST/PGUSER/PGDATABASE/...) — same as the rest of
 *   the sandbox.
 */
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { hashDataset, writeBenchResult, uploadBenchResult, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  tenantId: z.string().uuid().optional(),
  rlsPairs: z.number().int().min(0).max(20_000).default(2_000),
  subtreeQueries: z.number().int().min(0).max(2_000).default(200),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "node_count",
  "max_depth",
  "subtree_query_p50_ms",
  "subtree_query_p95_ms",
  "rls_check_p95_ms",
  "subtree_move_p95_ms",
  "index_bytes",
  "column_bytes",
  "migration_back_out_steps",
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

function timeQuery(sql: string): number {
  const start = performance.now();
  try {
    execFileSync("psql", ["-tA", "-c", sql], { stdio: ["ignore", "ignore", "ignore"] });
    return performance.now() - start;
  } catch {
    return -1;
  }
}

export async function run(input: Input): Promise<{ result: BenchResult; trips: string[] }> {
  const ranAt = new Date().toISOString();
  const metrics: Record<string, number> = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));
  // Back-out: drop column + drop GIN + drop trigger + drop function. 4 steps.
  metrics.migration_back_out_steps = 4;
  const sampledIds: string[] = [];
  const havePsql = psqlAvailable();

  if (havePsql) {
    metrics.node_count = Number(psqlScalar(`select count(*)::text from public.tenant_nodes`) || 0);
    metrics.max_depth = Number(
      psqlScalar(
        `select coalesce(max(coalesce(array_length(ancestry_ids,1),0)),0)::text from public.tenant_nodes`,
      ) || 0,
    );
    metrics.index_bytes = Number(
      psqlScalar(
        `select coalesce(pg_relation_size('public.tenant_nodes_ancestry_ids_idx'),0)::text`,
      ) || 0,
    );
    // ancestry_ids column bytes ≈ pg_column_size sum across rows.
    metrics.column_bytes = Number(
      psqlScalar(
        `select coalesce(sum(pg_column_size(ancestry_ids))::bigint,0)::text from public.tenant_nodes`,
      ) || 0,
    );

    if (metrics.node_count > 0) {
      const tenantPred = input.tenantId
        ? `and tenant_id = '${input.tenantId}'`
        : "";
      const sampleIds = psqlLines(
        `select id::text from public.tenant_nodes where ancestry_ids <> '{}'::uuid[] ${tenantPred} order by random() limit ${input.subtreeQueries}`,
      );
      sampledIds.push(...sampleIds.slice(0, 50));
      const subtreeTimings: number[] = [];
      for (const id of sampleIds) {
        const t = timeQuery(
          `select 1 from public.tenant_nodes where ancestry_ids @> array['${id}']::uuid[] limit 100`,
        );
        if (t >= 0) subtreeTimings.push(t);
      }
      metrics.subtree_query_p50_ms = Math.round(percentile(subtreeTimings, 50) * 100) / 100;
      metrics.subtree_query_p95_ms = Math.round(percentile(subtreeTimings, 95) * 100) / 100;

      // RLS-shape check: single-row ancestor membership. Pick random pairs.
      const pairs = Math.min(input.rlsPairs, Math.max(0, sampleIds.length));
      const rlsTimings: number[] = [];
      for (let i = 0; i < pairs; i++) {
        const a = sampleIds[Math.floor(Math.random() * sampleIds.length)];
        const b = sampleIds[Math.floor(Math.random() * sampleIds.length)];
        const t = timeQuery(
          `select 1 from public.tenant_nodes where id = '${a}'::uuid and ancestry_ids @> array['${b}']::uuid[] limit 1`,
        );
        if (t >= 0) rlsTimings.push(t);
      }
      metrics.rls_check_p95_ms = Math.round(percentile(rlsTimings, 95) * 100) / 100;
      // subtree_move not exercised — destructive write, requires a fixture
      // schema. Left 0 until first real-tree fixture lands (see benchmarks.md).
    }
  }

  const baseline = metrics.node_count < 5_000;
  const result: BenchResult = {
    adr: "adr-0003",
    ran_at: ranAt,
    dataset_hash: hashDataset(sampledIds.length ? sampledIds : ["empty"]),
    metrics,
    notes: !havePsql
      ? "no psql — zero-filled result; harness wiring verified"
      : baseline
        ? `baseline — node_count=${metrics.node_count} below 5k trigger; structural metrics only, status flip blocked per benchmarks.md`
        : "live measurement against real tenant_nodes",
  };

  const trips: string[] = [];
  if (!baseline && metrics.rls_check_p95_ms > 3) trips.push("rls_check_p95>3ms");
  if (!baseline && metrics.subtree_query_p95_ms > 50) trips.push("subtree_query_p95>50ms");
  if (trips.length) result.notes = `REVISIT ADR-0003 lean: ${trips.join(", ")}`;

  return { result, trips };
}

if (import.meta.main) {
  const input = InputSchema.parse({
    tenantId: process.env.TENANT_ID || undefined,
    rlsPairs: process.env.RLS_PAIRS ? Number(process.env.RLS_PAIRS) : undefined,
    subtreeQueries: process.env.SUBTREE_QUERIES ? Number(process.env.SUBTREE_QUERIES) : undefined,
  });
  const { result, trips } = await run(input);
  const path = writeBenchResult(result);
  const upload = await uploadBenchResult(result, trips);
  console.log(JSON.stringify({ wrote: path, upload, result }, null, 2));
}
