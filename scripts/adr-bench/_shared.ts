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

/**
 * Optionally upload a bench result to public.adr_bench_results so it shows on
 * /admin/adr-bench. Silent no-op when SUPABASE_URL or service role key are
 * absent (CI / local without secrets). Service role required: RLS allows
 * inserts only from authenticated operators or service role.
 */
export async function uploadBenchResult(
  result: BenchResult,
  trippedTriggers: ReadonlyArray<string> = [],
  source: "script" | "manual" = "script",
): Promise<{ uploaded: boolean; reason?: string }> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { uploaded: false, reason: "no SUPABASE_URL or SERVICE_ROLE_KEY" };
  try {
    const resp = await fetch(`${url}/rest/v1/adr_bench_results`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        adr: result.adr,
        ran_at: result.ran_at,
        dataset_hash: result.dataset_hash,
        metrics: result.metrics,
        notes: result.notes ?? null,
        tripped_triggers: trippedTriggers,
        source,
      }),
    });
    if (!resp.ok) return { uploaded: false, reason: `${resp.status} ${await resp.text().then((t) => t.slice(0, 200))}` };
    return { uploaded: true };
  } catch (e) {
    return { uploaded: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function notRunnable(adr: string, reason: string): never {
  throw new Error(
    `[${adr}] not yet runnable: ${reason}. See docs/adr/benchmarks.md § ${adr.toUpperCase()} for dataset prereqs.`,
  );
}
