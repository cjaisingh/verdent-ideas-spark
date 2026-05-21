#!/usr/bin/env -S bun run
/**
 * ADR-0003 benchmark — tenant-node ancestry storage.
 *
 * Compares materialised-path / ltree / parent_id+CTE / denormalised
 * ancestry_ids[] on the RLS-hot subtree-check path. Loads the real tenant
 * tree into four throwaway schemas, runs the metric loop, writes JSON.
 *
 * See docs/adr/benchmarks.md § ADR-0003 for thresholds.
 *
 * Not runnable until `tenant_nodes` exists (Phase 5 s5.1).
 */
import { z } from "zod";
import { notRunnable, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  pgUrl: z.string().url(),
  tenantId: z.string().uuid(),
  factRowsPerNode: z.number().int().min(1).max(10_000).default(1_000),
  randomPairs: z.number().int().min(100).max(50_000).default(5_000),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "subtree_query_p50_ms",
  "subtree_query_p95_ms",
  "rls_check_p95_ms",
  "subtree_move_p95_ms",
  "index_bytes",
  "column_bytes",
  "migration_back_out_steps",
] as const;

export async function run(_input: Input): Promise<BenchResult> {
  notRunnable("adr-0003", "tenant_nodes table does not exist yet");
}

if (import.meta.main) {
  const input = InputSchema.parse({
    pgUrl: process.env.PGURL ?? "",
    tenantId: process.env.TENANT_ID ?? "",
  });
  await run(input);
}
