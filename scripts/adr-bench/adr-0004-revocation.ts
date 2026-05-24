#!/usr/bin/env -S bun run
/**
 * ADR-0004 benchmark — alias revocation lookup latency.
 *
 * s5.3 M3/M4: real numbers, no zero-fill. Measures the cost of the
 * "is this alias revoked?" lookup that every /resolve call pays after
 * descriptor scan. Uses (tenant_id, revoked_at) index added in s5.3.
 *
 * Read-only against tenant_node_aliases. Acceptance thresholds live in
 * docs/adr/0004-alias-revocation-cascade.md § Acceptance.
 *
 * Sizes are clamped to the real corpus — we never refuse to run just because
 * the project hasn't reached 1M aliases yet; we record what we measured.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { writeBenchResult, uploadBenchResult, hashDataset, type BenchResult } from "./_shared.ts";

export const InputSchema = z.object({
  pgUrl: z.string().url(),
  iterations: z.number().int().min(10).max(2000).default(200),
  writeDecision: z.boolean().default(false),
});
export type Input = z.infer<typeof InputSchema>;

export const METRIC_KEYS = [
  "lookup_p50_ms",
  "lookup_p95_ms",
  "lookup_p99_ms",
  "alias_row_count",
  "iterations",
] as const;

type Row = { tenant_id: string; revoked_at: string | null };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function run(input: Input): Promise<BenchResult> {
  const sbUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !key) {
    throw new Error("ADR-0004 bench requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }

  // Sample tenant_ids that actually have aliases.
  const sampleResp = await fetch(
    `${sbUrl}/rest/v1/tenant_node_aliases?select=tenant_id,revoked_at&limit=2000`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const sample = (await sampleResp.json()) as Row[];
  const tenantIds = Array.from(new Set(sample.map((r) => r.tenant_id)));

  // Total row count (Range trick).
  const countResp = await fetch(
    `${sbUrl}/rest/v1/tenant_node_aliases?select=tenant_id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" } },
  );
  const totalRange = countResp.headers.get("content-range") ?? "0-0/0";
  const aliasRowCount = Number(totalRange.split("/").pop() ?? 0);

  // Measure: for each iteration, fetch active aliases for a random tenant.
  // This is the resolver's hot path on every /resolve.
  const latencies: number[] = [];
  const iters = input.iterations;
  for (let i = 0; i < iters; i++) {
    const tid = tenantIds[i % Math.max(1, tenantIds.length)] ?? "00000000-0000-0000-0000-000000000000";
    const t0 = performance.now();
    await fetch(
      `${sbUrl}/rest/v1/tenant_node_aliases?select=id&tenant_id=eq.${tid}&revoked_at=is.null&limit=50`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    latencies.push(performance.now() - t0);
  }
  latencies.sort((a, b) => a - b);

  const result: BenchResult = {
    adr: "adr-0004",
    ran_at: new Date().toISOString(),
    dataset_hash: hashDataset([aliasRowCount, tenantIds.length, iters]),
    metrics: {
      lookup_p50_ms: +percentile(latencies, 50).toFixed(2),
      lookup_p95_ms: +percentile(latencies, 95).toFixed(2),
      lookup_p99_ms: +percentile(latencies, 99).toFixed(2),
      alias_row_count: aliasRowCount,
      iterations: iters,
    },
    notes:
      `Sampled ${tenantIds.length} tenants over ${iters} iterations against a ` +
      `corpus of ${aliasRowCount} aliases. Uses idx_alias_tenant_revoked.`,
  };

  const tripped: string[] = [];
  let branch: "in_table" | "add_brin" | "flip_to_mv" = "in_table";
  if (result.metrics.lookup_p95_ms > 40) {
    tripped.push("p95_gt_40ms_flip_to_mv");
    branch = "flip_to_mv";
  } else if (result.metrics.lookup_p95_ms > 15) {
    tripped.push("p95_gt_15ms_add_brin");
    branch = "add_brin";
  }

  writeBenchResult(result);
  await uploadBenchResult(result, tripped, "script");

  if (input.writeDecision) {
    writeAdrDecision({
      branch,
      metrics: result.metrics,
      tripped,
      ranAt: result.ran_at,
      datasetHash: result.dataset_hash,
    });
  }
  return result;
}

interface AdrDecisionInput {
  branch: "in_table" | "add_brin" | "flip_to_mv";
  metrics: BenchResult["metrics"];
  tripped: ReadonlyArray<string>;
  ranAt: string;
  datasetHash: string;
}

/**
 * Patch `docs/adr/0004-alias-revocation-cascade.md` in place:
 *   - Flips `Status: proposed` → `Status: accepted` ONLY when corpus is
 *     meaningful (>= 1000 aliases). Below that the bench is contingent
 *     per the M4 status note; we still write an annotation but never flip.
 *   - Appends a "Bench decision" block under §Acceptance recording branch,
 *     p95, dataset hash, and the timestamp.
 *
 * Idempotent: the block is keyed by `<!-- adr-0004-write-decision -->` and
 * replaced on subsequent runs.
 */
function writeAdrDecision(d: AdrDecisionInput): void {
  const path = "docs/adr/0004-alias-revocation-cascade.md";
  const raw = readFileSync(path, "utf8");

  const meaningfulCorpus = d.metrics.alias_row_count >= 1000;
  const next = meaningfulCorpus
    ? raw.replace(/^- \*\*Status:\*\* proposed$/m, "- **Status:** accepted")
    : raw;

  const block = [
    "<!-- adr-0004-write-decision -->",
    "### Bench decision (`--write-decision`)",
    "",
    `- **Ran at:** ${d.ranAt}`,
    `- **Dataset hash:** \`${d.datasetHash}\` (alias_row_count=${d.metrics.alias_row_count}, iterations=${d.metrics.iterations})`,
    `- **p50 / p95 / p99 (ms):** ${d.metrics.lookup_p50_ms} / ${d.metrics.lookup_p95_ms} / ${d.metrics.lookup_p99_ms}`,
    `- **Chosen branch:** \`${d.branch}\` ${d.tripped.length ? `(tripped: ${d.tripped.join(", ")})` : "(no thresholds tripped)"}`,
    `- **Status flip:** ${meaningfulCorpus ? "yes — corpus ≥ 1000" : "no — corpus < 1000, decision remains contingent"}`,
    "<!-- /adr-0004-write-decision -->",
    "",
  ].join("\n");

  const blockRe = /<!-- adr-0004-write-decision -->[\s\S]*?<!-- \/adr-0004-write-decision -->\n?/;
  const withBlock = blockRe.test(next) ? next.replace(blockRe, block) : `${next.trimEnd()}\n\n${block}`;

  writeFileSync(path, withBlock);
}

if (import.meta.main) {
  const input = InputSchema.parse({
    pgUrl: process.env.PGURL ?? process.env.SUPABASE_URL ?? "http://placeholder.local",
    iterations: process.env.BENCH_ITERATIONS ? Number(process.env.BENCH_ITERATIONS) : undefined,
    writeDecision: process.argv.includes("--write-decision"),
  });
  const r = await run(input);
  console.log(JSON.stringify(r, null, 2));
}
