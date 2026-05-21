#!/usr/bin/env -S bun run
/**
 * ADR-0004 benchmark — alias revocation cascade.
 *
 * Read-only. Measures blast radius + operator dwell time from real
 * tenant_node_aliases / alias_events / canonical_facts. Picks between
 * soft / hard / hybrid per docs/adr/benchmarks.md § ADR-0004 thresholds.
 *
 * s5.3 Milestone 1: table now exists. Bench remains a stub until merge/split
 * handlers + canonical_facts (Phase 6) provide real numerators. Returns
 * notRunnable so CI does not record zero-filled rows in adr_bench_results.
 */
import { z } from "zod";
import { notRunnable, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  pgUrl: z.string().url(),
  windowDays: z.number().int().min(7).max(180).default(30),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "affected_facts_p95",
  "kr_rollups_grey_seconds_p95",
  "stale_badge_dwell_p95_days",
  "compliance_revocation_count_30d",
] as const;

export async function run(_input: Input): Promise<BenchResult> {
  notRunnable("adr-0004", "tenant_node_aliases table does not exist yet");
}

if (import.meta.main) {
  const input = InputSchema.parse({ pgUrl: process.env.PGURL ?? "" });
  await run(input);
}
