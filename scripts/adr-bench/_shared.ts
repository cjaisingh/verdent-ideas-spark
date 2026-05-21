/**
 * Shared helpers for ADR benchmark scripts.
 *
 * Each `adr-000X-*.ts` script imports from here so every result JSON has the
 * same shape and lands in the same place. See docs/adr/benchmarks.md for
 * decision thresholds.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BenchResult {
  adr: string;
  ran_at: string;
  dataset_hash: string;
  metrics: Record<string, number>;
  notes?: string;
}

const RESULTS_DIR = "bench-results";

export function hashDataset(rowIds: ReadonlyArray<string | number>): string {
  const h = createHash("sha256");
  for (const id of rowIds) h.update(String(id));
  h.update(`|n=${rowIds.length}`);
  return h.digest("hex").slice(0, 16);
}

export function writeBenchResult(result: BenchResult): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = result.ran_at.replace(/[:.]/g, "-");
  const path = join(RESULTS_DIR, `${result.adr}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

export function notRunnable(adr: string, reason: string): never {
  throw new Error(
    `[${adr}] not yet runnable: ${reason}. See docs/adr/benchmarks.md § ${adr.toUpperCase()} for dataset prereqs.`,
  );
}
