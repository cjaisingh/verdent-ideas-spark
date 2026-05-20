#!/usr/bin/env bun
/**
 * Multi-rule baseline freeze. See scripts/lint-ratchet.ts for the live check.
 *
 *   bun scripts/lint-ratchet-freeze.ts                          # dry-run, all rules
 *   bun scripts/lint-ratchet-freeze.ts --rule X                 # dry-run one rule
 *   bun scripts/lint-ratchet-freeze.ts --rule X --seed --confirm  # seed a brand-new baseline
 *   bun scripts/lint-ratchet-freeze.ts --confirm                # freeze all eligible rules
 *
 * Flags:
 *   --confirm     Required to actually write.
 *   --rule <id>   Limit to a single rule.
 *   --seed        Create a baseline from scratch for the rule (requires --rule).
 *                 No comparison; whatever is currently violated becomes the budget.
 *   --allow-grow  Allow total to stay equal (never increase). Per-file growth still blocked.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, renameSync, copyFileSync, mkdirSync } from "node:fs";
import { relative, resolve, dirname } from "node:path";
import { loadConfig, loadBaselineFor, type RatchetRule, type Baseline } from "./lint-ratchet-config";

const ROOT = process.cwd();
const CONFIRM = process.argv.includes("--confirm");
const SEED = process.argv.includes("--seed");
const ALLOW_GROW = process.argv.includes("--allow-grow");
const ONLY_RULE = (() => {
  const i = process.argv.indexOf("--rule");
  return i >= 0 ? process.argv[i + 1] : null;
})();

function die(msg: string, code = 1): never {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

function runEslint(): Array<{ filePath: string; messages: Array<{ ruleId: string | null }> }> {
  const res = spawnSync("npx", ["eslint", "--format", "json", "."], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (!res.stdout) {
    console.error(res.stderr);
    die("eslint produced no JSON output", 2);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    die(`failed to parse eslint JSON: ${(e as Error).message}`, 2);
  }
}

function countsForRule(
  files: ReturnType<typeof runEslint>,
  ruleId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) {
    let n = 0;
    for (const m of f.messages) if (m.ruleId === ruleId) n++;
    if (n > 0) out[relative(ROOT, f.filePath)] = n;
  }
  return out;
}

function writeBaselineFile(rule: RatchetRule, counts: Record<string, number>) {
  const sorted = Object.fromEntries(Object.entries(counts).sort());
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  const next: Baseline = {
    generatedAt: new Date().toISOString(),
    rule: rule.rule,
    total,
    files: sorted,
  };
  const target = resolve(ROOT, rule.baseline);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    copyFileSync(target, target.replace(/\.json$/, ".prev.json"));
  }
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, target);
  return total;
}

function freezeRule(rule: RatchetRule, eslintFiles: ReturnType<typeof runEslint>): boolean {
  console.log(`\n=== ${rule.rule} ===`);
  const live = countsForRule(eslintFiles, rule.rule);
  const liveTotal = Object.values(live).reduce((a, b) => a + b, 0);

  if (SEED) {
    console.log(`Seeding new baseline at ${rule.baseline}`);
    console.log(`Live: ${liveTotal} violations in ${Object.keys(live).length} files.`);
    if (!CONFIRM) {
      console.log(`Dry run. Pass --confirm to write.`);
      return false;
    }
    const total = writeBaselineFile(rule, live);
    console.log(`✓ baseline seeded: total ${total}`);
    return true;
  }

  const baseline = loadBaselineFor(rule);
  if (!baseline) {
    die(
      `baseline missing at ${rule.baseline}. Seed it with: bun run lint:freeze --rule ${rule.rule} --seed --confirm`,
    );
  }

  type Diff = { path: string; was: number; now: number };
  const grown: Diff[] = [];
  const shrunk: Diff[] = [];
  const cleared: Diff[] = [];
  const added: Diff[] = [];

  for (const [path, now] of Object.entries(live)) {
    const was = baseline.files[path] ?? 0;
    if (was === 0) added.push({ path, was, now });
    else if (now > was) grown.push({ path, was, now });
    else if (now < was) shrunk.push({ path, was, now });
  }
  for (const [path, was] of Object.entries(baseline.files)) {
    if (!(path in live)) cleared.push({ path, was, now: 0 });
  }

  console.log(`baseline: ${baseline.total} (${Object.keys(baseline.files).length} files)`);
  console.log(`live:     ${liveTotal} (${Object.keys(live).length} files)`);
  if (shrunk.length) {
    console.log(`✓ shrank:`);
    for (const f of shrunk) console.log(`    ${f.was} → ${f.now}  ${f.path}`);
  }
  if (cleared.length) {
    console.log(`✓ cleared:`);
    for (const f of cleared) console.log(`    ${f.was} → 0     ${f.path}`);
  }
  if (grown.length) {
    console.log(`✗ grew (BLOCKS freeze):`);
    for (const f of grown) console.log(`    ${f.was} → ${f.now}  ${f.path}`);
  }
  if (added.length) {
    console.log(`✗ new files outside baseline (BLOCKS freeze):`);
    for (const f of added) console.log(`    +${f.now}  ${f.path}`);
  }

  if (grown.length) die(`[${rule.rule}] some files grew. Fix them before freezing.`);
  if (added.length)
    die(`[${rule.rule}] new files outside baseline. Clean them up — do not enshrine.`);

  if (liveTotal > baseline.total) {
    die(`[${rule.rule}] live total ${liveTotal} > baseline ${baseline.total}. Refusing.`);
  }
  if (liveTotal === baseline.total && !ALLOW_GROW) {
    console.log(`No improvement. Skipping.`);
    return false;
  }
  if (liveTotal === baseline.total && ALLOW_GROW && shrunk.length === 0 && cleared.length === 0) {
    die(`[${rule.rule}] --allow-grow set but no per-file improvement. Aborting.`);
  }

  const delta = baseline.total - liveTotal;
  console.log(`Proposed: ${baseline.total} → ${liveTotal} (-${delta}).`);
  if (!CONFIRM) {
    console.log(`Dry run. Re-run with --confirm to write.`);
    return false;
  }
  const total = writeBaselineFile(rule, live);
  console.log(`✓ frozen: total ${total}.`);
  return true;
}

function main() {
  if (SEED && !ONLY_RULE) die(`--seed requires --rule <id>.`);
  const config = loadConfig();
  const rules = ONLY_RULE ? config.rules.filter((r) => r.rule === ONLY_RULE) : config.rules;
  if (rules.length === 0) die(`no matching rules${ONLY_RULE ? ` for --rule ${ONLY_RULE}` : ""}`);

  // --seed creates a baseline that doesn't exist yet, so don't try to lint
  // if the user only wants to seed a rule that has nothing live.
  const eslintFiles = runEslint();

  let wrote = 0;
  for (const rule of rules) {
    if (freezeRule(rule, eslintFiles)) wrote++;
  }
  console.log(``);
  if (CONFIRM) console.log(`✓ ${wrote}/${rules.length} rule baseline(s) updated.`);
  else console.log(`Dry run complete. Pass --confirm to write.`);
}

main();
