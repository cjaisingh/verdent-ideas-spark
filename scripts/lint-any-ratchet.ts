#!/usr/bin/env bun
/**
 * no-explicit-any ratchet.
 *
 * Compares the live `@typescript-eslint/no-explicit-any` count against
 * `.lint-baselines/no-explicit-any.json`. The baseline is the budget — it can
 * only ever shrink.
 *
 * Modes:
 *   bun scripts/lint-any-ratchet.ts            # check, exit 1 on regression
 *   bun scripts/lint-any-ratchet.ts --write    # lower baseline to live counts
 *
 * Even with --write, no entry is ever *raised*. Defence in depth so a noisy
 * branch can't accidentally enshrine a regression.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";

const RULE = "@typescript-eslint/no-explicit-any";
const BASELINE_PATH = ".lint-baselines/no-explicit-any.json";
const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");

type Baseline = {
  generatedAt: string;
  rule: string;
  total: number;
  files: Record<string, number>;
};

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`✗ baseline missing: ${BASELINE_PATH}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

function runEslint(): Record<string, number> {
  const res = spawnSync("npx", ["eslint", "--format", "json", "."], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  // eslint exits non-zero whenever there are problems; we only care about stdout.
  if (!res.stdout) {
    console.error("✗ eslint produced no JSON output");
    console.error(res.stderr);
    process.exit(2);
  }
  let parsed: Array<{ filePath: string; messages: Array<{ ruleId: string | null }> }>;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    console.error("✗ failed to parse eslint JSON:", (e as Error).message);
    process.exit(2);
  }
  const counts: Record<string, number> = {};
  for (const f of parsed) {
    let n = 0;
    for (const m of f.messages) if (m.ruleId === RULE) n++;
    if (n > 0) counts[relative(ROOT, f.filePath)] = n;
  }
  return counts;
}

function main() {
  const baseline = loadBaseline();
  const live = runEslint();

  const liveTotal = Object.values(live).reduce((a, b) => a + b, 0);
  const liveFiles = Object.keys(live).length;

  const regressedFiles: Array<{ path: string; was: number; now: number }> = [];
  const newFiles: Array<{ path: string; now: number }> = [];
  const improvedFiles: Array<{ path: string; was: number; now: number }> = [];
  const clearedFiles: string[] = [];

  for (const [path, now] of Object.entries(live)) {
    const was = baseline.files[path] ?? 0;
    if (was === 0) newFiles.push({ path, now });
    else if (now > was) regressedFiles.push({ path, was, now });
    else if (now < was) improvedFiles.push({ path, was, now });
  }
  for (const [path, was] of Object.entries(baseline.files)) {
    if (!(path in live)) clearedFiles.push(path);
  }

  console.log(
    `no-explicit-any: live=${liveTotal} (${liveFiles} files) | baseline=${baseline.total} (${
      Object.keys(baseline.files).length
    } files)`,
  );

  const failed = regressedFiles.length > 0 || newFiles.length > 0 || liveTotal > baseline.total;

  if (newFiles.length) {
    console.error(`\n✗ ${newFiles.length} file(s) introduced new \`any\` (not in baseline):`);
    for (const f of newFiles) console.error(`    +${f.now}  ${f.path}`);
  }
  if (regressedFiles.length) {
    console.error(`\n✗ ${regressedFiles.length} file(s) regressed:`);
    for (const f of regressedFiles)
      console.error(`    ${f.was} → ${f.now}  ${f.path}`);
  }

  if (improvedFiles.length || clearedFiles.length) {
    console.log(
      `\n✓ improvements: ${improvedFiles.length} file(s) shrank, ${clearedFiles.length} file(s) cleared.`,
    );
    if (!WRITE) {
      console.log(`  run \`bun run lint:ratchet -- --write\` to lower the baseline.`);
    }
  }

  if (failed) {
    console.error(`\nBlocked: \`any\` budget exceeded. Don't add new \`any\` — narrow the type.`);
    process.exit(1);
  }

  if (WRITE) {
    // Lower-only merge: never raise any entry beyond its current baseline.
    const merged: Record<string, number> = {};
    for (const [path, now] of Object.entries(live)) {
      const was = baseline.files[path] ?? Number.POSITIVE_INFINITY;
      merged[path] = Math.min(now, was);
    }
    const sorted = Object.fromEntries(Object.entries(merged).sort());
    const newTotal = Object.values(sorted).reduce((a, b) => a + b, 0);
    const next: Baseline = {
      generatedAt: new Date().toISOString(),
      rule: RULE,
      total: newTotal,
      files: sorted,
    };
    writeFileSync(resolve(ROOT, BASELINE_PATH), JSON.stringify(next, null, 2) + "\n");
    console.log(`\n✓ baseline rewritten: total ${baseline.total} → ${newTotal}`);
  } else {
    console.log(`\n✓ within budget.`);
  }
}

main();
