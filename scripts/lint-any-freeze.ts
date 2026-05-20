#!/usr/bin/env bun
/**
 * Safer baseline regenerator for `@typescript-eslint/no-explicit-any`.
 *
 * Unlike `lint:ratchet -- --write`, which silently lowers entries in-place,
 * this script:
 *   1. Refuses to run without `--confirm`.
 *   2. Recomputes live counts from eslint JSON.
 *   3. Refuses to write if the new total would be ≥ the existing total.
 *   4. Refuses to write if any individual file's count would rise.
 *   5. Prints a full diff before writing and requires `--confirm` to commit.
 *   6. Writes atomically via a `.tmp` swap.
 *   7. Snapshots the prior baseline to `.lint-baselines/no-explicit-any.prev.json`
 *      so an accidental freeze can be rolled back with `git checkout` or by hand.
 *
 * Usage:
 *   bun scripts/lint-any-freeze.ts            # dry-run, prints diff, exits 0
 *   bun scripts/lint-any-freeze.ts --confirm  # write the new baseline
 *
 * Flags:
 *   --confirm       Required to actually write.
 *   --allow-grow    Escape hatch: allow total to stay equal (never increase).
 *                   Per-file growth is still blocked. Use only when you've
 *                   moved code between files and the totals net to the same.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from "node:fs";
import { relative, resolve, dirname } from "node:path";

const RULE = "@typescript-eslint/no-explicit-any";
const BASELINE_PATH = ".lint-baselines/no-explicit-any.json";
const PREV_PATH = ".lint-baselines/no-explicit-any.prev.json";
const ROOT = process.cwd();

const CONFIRM = process.argv.includes("--confirm");
const ALLOW_GROW = process.argv.includes("--allow-grow");

type Baseline = {
  generatedAt: string;
  rule: string;
  total: number;
  files: Record<string, number>;
};

function die(msg: string, code = 1): never {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) die(`baseline missing: ${BASELINE_PATH}`, 2);
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

function runEslint(): Record<string, number> {
  const res = spawnSync("npx", ["eslint", "--format", "json", "."], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (!res.stdout) {
    console.error(res.stderr);
    die("eslint produced no JSON output", 2);
  }
  let parsed: Array<{ filePath: string; messages: Array<{ ruleId: string | null }> }>;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    die(`failed to parse eslint JSON: ${(e as Error).message}`, 2);
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
  const baseTotal = baseline.total;

  type Diff = { path: string; was: number; now: number };
  const grown: Diff[] = [];
  const shrunk: Diff[] = [];
  const cleared: Diff[] = [];
  const added: Diff[] = [];
  const unchanged: Diff[] = [];

  for (const [path, now] of Object.entries(live)) {
    const was = baseline.files[path] ?? 0;
    if (was === 0) added.push({ path, was, now });
    else if (now > was) grown.push({ path, was, now });
    else if (now < was) shrunk.push({ path, was, now });
    else unchanged.push({ path, was, now });
  }
  for (const [path, was] of Object.entries(baseline.files)) {
    if (!(path in live)) cleared.push({ path, was, now: 0 });
  }

  console.log(`baseline: ${baseTotal} (${Object.keys(baseline.files).length} files)`);
  console.log(`live:     ${liveTotal} (${Object.keys(live).length} files)`);
  console.log(``);
  if (shrunk.length) {
    console.log(`✓ ${shrunk.length} file(s) shrank:`);
    for (const f of shrunk) console.log(`    ${f.was} → ${f.now}  ${f.path}`);
  }
  if (cleared.length) {
    console.log(`✓ ${cleared.length} file(s) cleared:`);
    for (const f of cleared) console.log(`    ${f.was} → 0     ${f.path}`);
  }
  if (grown.length) {
    console.log(`✗ ${grown.length} file(s) grew (BLOCKS freeze):`);
    for (const f of grown) console.log(`    ${f.was} → ${f.now}  ${f.path}`);
  }
  if (added.length) {
    console.log(`✗ ${added.length} new file(s) outside baseline (BLOCKS freeze):`);
    for (const f of added) console.log(`    +${f.now}  ${f.path}`);
  }
  console.log(``);

  // Hard refusals — never silently freeze a regression.
  if (grown.length) die(`some files grew. Fix them or revert before freezing.`);
  if (added.length) die(`new files outside baseline. These must shrink to 0 or be cleaned up — not enshrined.`);

  if (liveTotal > baseTotal) {
    die(`live total ${liveTotal} > baseline ${baseTotal}. Refusing to freeze a regression.`);
  }
  if (liveTotal === baseTotal && !ALLOW_GROW) {
    console.log(`No improvement (live total equals baseline). Nothing to freeze.`);
    console.log(`Pass --allow-grow if you intentionally moved \`any\` between files.`);
    process.exit(0);
  }
  if (liveTotal === baseTotal && ALLOW_GROW && shrunk.length === 0 && cleared.length === 0) {
    die(`--allow-grow set but no per-file improvement detected. Aborting.`);
  }

  const delta = baseTotal - liveTotal;
  console.log(`Proposed new baseline total: ${liveTotal} (delta -${delta}).`);

  if (!CONFIRM) {
    console.log(``);
    console.log(`Dry run. Re-run with --confirm to write:`);
    console.log(`    bun scripts/lint-any-freeze.ts --confirm`);
    process.exit(0);
  }

  // Build next baseline from live, sorted for stable diffs.
  const sorted = Object.fromEntries(Object.entries(live).sort());
  const next: Baseline = {
    generatedAt: new Date().toISOString(),
    rule: RULE,
    total: liveTotal,
    files: sorted,
  };

  // Snapshot prior baseline alongside, then atomic swap of the live file.
  const target = resolve(ROOT, BASELINE_PATH);
  const prev = resolve(ROOT, PREV_PATH);
  const tmp = `${target}.tmp`;
  copyFileSync(target, prev);
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, target);

  console.log(``);
  console.log(`✓ baseline frozen: ${baseTotal} → ${liveTotal} (-${delta}).`);
  console.log(`  prior snapshot:  ${relative(ROOT, prev)}`);
  console.log(`  Review with: git diff ${BASELINE_PATH}`);
}

main();
