/**
 * Convert a bench-result JSON into:
 *   1. A 4–6 row "Consequences" markdown table for the target ADR
 *   2. A ready-to-paste CHANGELOG bullet
 *
 * Usage:
 *   bun scripts/adr-bench/format-consequences.ts bench-results/adr-0006-2026-05-21T06-00-00-000Z.json
 *   bun scripts/adr-bench/format-consequences.ts <path> --write   # patch the ADR + CHANGELOG in place
 *
 * Pure read by default; --write appends the bullet to CHANGELOG.md under
 * "## Unreleased" and replaces the "## Consequences" section of the target
 * ADR (docs/adr/<adr>-*.md) with the freshly generated table.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateBench, ADR_DECISION_QUESTIONS, type TriggerStatus } from "../../src/lib/adr-bench-thresholds";
import type { BenchResult } from "./_shared";

type Row = { metric: string; value: string; threshold: string; status: TriggerStatus; note: string };

const STATUS_EMOJI: Record<TriggerStatus, string> = { green: "🟢", watch: "🟡", revisit: "🔴" };

// Metric definitions per ADR — keep in sync with docs/adr/benchmarks.md.
// Order matters: first 4–6 are rendered.
const METRIC_ROWS: Record<string, ReadonlyArray<{ key: string; label: string; threshold: string; format?: (n: number) => string }>> = {
  "adr-0003": [
    { key: "rls_check_p95_ms", label: "RLS check p95 (ms)", threshold: "< 3 ms" },
    { key: "subtree_move_p95_ms", label: "Subtree move p95 (ms)", threshold: "< 500 ms" },
    { key: "ancestry_write_amp", label: "Ancestry write amplification", threshold: "< 3× parent_id" },
    { key: "tree_depth_p95", label: "Tree depth p95", threshold: "informational" },
  ],
  "adr-0004": [
    { key: "affected_facts_p95", label: "Affected facts p95", threshold: "≤ 1000 (≤ 200 hybrid)" },
    { key: "stale_badge_dwell_p95_days", label: "Stale-badge dwell p95 (days)", threshold: "≤ 14 days" },
    { key: "operator_overrides_30d", label: "Operator overrides / 30d", threshold: "informational" },
    { key: "revocation_count_30d", label: "Revocations / 30d", threshold: "informational" },
  ],
  "adr-0005": [
    { key: "false_positive_rate", label: "False-positive rate", threshold: "≤ 10%", format: (n) => `${(n * 100).toFixed(1)}%` },
    { key: "heuristic_coverage_pct", label: "Heuristic coverage", threshold: "≥ 70% (hybrid)", format: (n) => `${n.toFixed(1)}%` },
    { key: "llm_spend_eur_30d", label: "LLM spend / 30d (€)", threshold: "informational", format: (n) => `€${n.toFixed(2)}` },
    { key: "pattern_match_p95_ms", label: "Pattern match p95 (ms)", threshold: "informational" },
  ],
  "adr-0006": [
    { key: "embedding_spend_eur_30d", label: "Embedding spend / 30d (€)", threshold: "≤ €50", format: (n) => `€${n.toFixed(2)}` },
    { key: "vector_row_count_max", label: "Vector rows (max table)", threshold: "≤ 1,000,000", format: (n) => n.toLocaleString("en-GB") },
    { key: "recall_at_10", label: "Recall@10", threshold: "informational", format: (n) => n.toFixed(3) },
    { key: "ann_query_p95_ms", label: "ANN query p95 (ms)", threshold: "informational" },
  ],
};

function fmt(value: number | undefined, formatter?: (n: number) => string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return formatter ? formatter(value) : String(value);
}

function buildRows(result: BenchResult): Row[] {
  const adr = result.adr.toLowerCase();
  const defs = METRIC_ROWS[adr];
  if (!defs) throw new Error(`Unknown ADR "${result.adr}" — extend METRIC_ROWS in format-consequences.ts`);
  const evaluation = evaluateBench(adr, result.metrics);
  const tripped = new Set(evaluation.tripped.map((s) => s.split(" ")[0]));
  const watch = new Set(evaluation.watch.map((s) => s.split(" ")[0]));
  return defs.slice(0, 6).map((d) => {
    const status: TriggerStatus = tripped.has(d.key) ? "revisit" : watch.has(d.key) ? "watch" : "green";
    const note = status === "revisit" ? "Revisit trigger fired" : status === "watch" ? "Near threshold" : "Within budget";
    return {
      metric: d.label,
      value: fmt(result.metrics[d.key], d.format),
      threshold: d.threshold,
      status,
      note,
    };
  });
}

function renderTable(rows: Row[]): string {
  const header = "| Metric | Value | Threshold | Status | Note |\n|---|---|---|---|---|";
  const body = rows
    .map((r) => `| ${r.metric} | ${r.value} | ${r.threshold} | ${STATUS_EMOJI[r.status]} ${r.status} | ${r.note} |`)
    .join("\n");
  return `${header}\n${body}`;
}

function renderChangelogBullet(result: BenchResult, rows: Row[]): string {
  const evaluation = evaluateBench(result.adr.toLowerCase(), result.metrics);
  const overall: TriggerStatus = evaluation.tripped.length ? "revisit" : evaluation.watch.length ? "watch" : "green";
  const date = result.ran_at.slice(0, 10);
  const headline = rows
    .filter((r) => r.status !== "green")
    .slice(0, 2)
    .map((r) => `${r.metric} ${r.value}`)
    .join("; ");
  const tail = evaluation.tripped.length
    ? ` — revisit triggers: ${evaluation.tripped.join(", ")}`
    : evaluation.watch.length
    ? ` — watch: ${evaluation.watch.join(", ")}`
    : " — all metrics within budget";
  const summary = headline ? ` (${headline})` : "";
  return `- **${result.adr.toUpperCase()} bench** (${date}, dataset \`${result.dataset_hash}\`): ${STATUS_EMOJI[overall]} ${overall}${summary}${tail}.`;
}

function findAdrFile(adr: string): string | null {
  const dir = "docs/adr";
  const match = readdirSync(dir).find((f) => f.toLowerCase().startsWith(`${adr.toLowerCase()}-`) && f.endsWith(".md"));
  return match ? join(dir, match) : null;
}

function patchAdrConsequences(adrFile: string, table: string): void {
  const src = readFileSync(adrFile, "utf8");
  const heading = /^## Consequences\s*$/m;
  if (!heading.test(src)) throw new Error(`No "## Consequences" section in ${adrFile}`);
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^## Consequences\s*$/.test(l));
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  const next = [
    ...lines.slice(0, start + 1),
    "",
    `_Last bench: ${new Date().toISOString().slice(0, 10)} — generated by \`scripts/adr-bench/format-consequences.ts\`._`,
    "",
    table,
    "",
    ...lines.slice(end),
  ].join("\n");
  writeFileSync(adrFile, next);
}

function patchChangelog(bullet: string): void {
  const file = "CHANGELOG.md";
  const src = readFileSync(file, "utf8");
  const marker = /^## Unreleased\s*$/m;
  if (!marker.test(src)) throw new Error('No "## Unreleased" section in CHANGELOG.md');
  const next = src.replace(marker, (m) => `${m}\n\n${bullet}`);
  writeFileSync(file, next);
}

function main(): void {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  const write = args.includes("--write");
  if (!path) {
    console.error("usage: bun scripts/adr-bench/format-consequences.ts <bench-result.json> [--write]");
    process.exit(2);
  }
  const result = JSON.parse(readFileSync(path, "utf8")) as BenchResult;
  const rows = buildRows(result);
  const table = renderTable(rows);
  const bullet = renderChangelogBullet(result, rows);

  const question = ADR_DECISION_QUESTIONS[result.adr.toLowerCase()] ?? "(no decision question on file)";
  console.log(`# ${result.adr.toUpperCase()} — Consequences`);
  console.log(`> ${question}`);
  console.log("");
  console.log(table);
  console.log("");
  console.log("## CHANGELOG bullet");
  console.log(bullet);

  if (write) {
    const adrFile = findAdrFile(result.adr);
    if (!adrFile) throw new Error(`No ADR file found for ${result.adr} under docs/adr/`);
    patchAdrConsequences(adrFile, table);
    patchChangelog(bullet);
    console.error(`\n✓ patched ${adrFile}`);
    console.error(`✓ patched CHANGELOG.md`);
  }
}

main();
