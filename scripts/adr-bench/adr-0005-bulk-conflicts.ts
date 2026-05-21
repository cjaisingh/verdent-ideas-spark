#!/usr/bin/env -S bun run
/**
 * ADR-0005 benchmark — bulk conflict pattern detection.
 *
 * Runs the real conflict pile through (a) heuristic group-by and (b) LLM
 * pattern-suggestion on the residual tail. Emits coverage + cost + operator
 * time metrics per docs/adr/benchmarks.md § ADR-0005.
 *
 * Not runnable until `fact_conflicts` exists (Phase 6 s6.1).
 */
import { z } from "zod";
import { notRunnable, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  pgUrl: z.string().url(),
  pileSize: z.number().int().min(50).default(100),
  llmSiblingThreshold: z.number().int().min(2).max(50).default(5),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "heuristic_coverage_pct",
  "llm_residual_coverage_pct",
  "llm_tokens_per_conflict_resolved_p50",
  "llm_tokens_per_conflict_resolved_p95",
  "false_positive_rate",
  "time_to_clear_pile_minutes_p95",
] as const;

export async function run(_input: Input): Promise<BenchResult> {
  notRunnable("adr-0005", "fact_conflicts table does not exist yet");
}

if (import.meta.main) {
  const input = InputSchema.parse({ pgUrl: process.env.PGURL ?? "" });
  await run(input);
}
