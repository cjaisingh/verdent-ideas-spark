#!/usr/bin/env bun
/**
 * Multi-rule ESLint ratchet.
 *
 * Reads `.lint-baselines/ratchet.config.json` (see scripts/lint-ratchet-config.ts)
 * and enforces every listed rule against its own baseline. Baselines can only
 * shrink. Any file that grows or any new file outside the baseline fails the
 * build.
 *
 * Modes:
 *   bun scripts/lint-ratchet.ts              # check, exit 1 on regression
 *   bun scripts/lint-ratchet.ts --rule X     # only check rule X
 *   bun scripts/lint-ratchet.ts --write      # lower baselines to live counts
 *
 * Also emits GitHub Actions annotations when GITHUB_ACTIONS=true so reviewers
 * see exact files + lines that broke the budget.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadConfig, loadBaselineFor, type RatchetRule, type Baseline } from "./lint-ratchet-config";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");
const ONLY_RULE = (() => {
  const i = process.argv.indexOf("--rule");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const IN_GHA = process.env.GITHUB_ACTIONS === "true";

type Occurrence = { line: number; column: number };
type FileReport = { count: number; occurrences: Occurrence[] };
type EslintFile = {
  filePath: string;
  messages: Array<{ ruleId: string | null; line?: number; column?: number }>;
};

function gha(line: string) {
  if (IN_GHA) console.log(line);
}

function ghaAnnotation(
  level: "error" | "warning" | "notice",
  file: string,
  loc: Occurrence | null,
  message: string,
) {
  if (!IN_GHA) return;
  const parts = [`file=${file}`];
  if (loc) parts.push(`line=${loc.line}`, `col=${loc.column}`);
  const msg = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::${level} ${parts.join(",")}::${msg}`);
}

function runEslintOnce(): EslintFile[] {
  const res = spawnSync("npx", ["eslint", "--format", "json", "."], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (!res.stdout) {
    console.error("✗ eslint produced no JSON output");
    console.error(res.stderr);
    process.exit(2);
  }
  try {
    return JSON.parse(res.stdout) as EslintFile[];
  } catch (e) {
    console.error("✗ failed to parse eslint JSON:", (e as Error).message);
    process.exit(2);
  }
}

function countForRule(files: EslintFile[], ruleId: string): Record<string, FileReport> {
  const out: Record<string, FileReport> = {};
  for (const f of files) {
    const occ: Occurrence[] = [];
    for (const m of f.messages) {
      if (m.ruleId === ruleId) occ.push({ line: m.line ?? 1, column: m.column ?? 1 });
    }
    if (occ.length > 0) out[relative(ROOT, f.filePath)] = { count: occ.length, occurrences: occ };
  }
  return out;
}

type RuleOutcome = {
  rule: RatchetRule;
  baseline: Baseline;
  live: Record<string, FileReport>;
  liveTotal: number;
  regressedFiles: Array<{ path: string; was: number; now: number }>;
  newFiles: Array<{ path: string; now: number }>;
  improvedFiles: Array<{ path: string; was: number; now: number }>;
  clearedFiles: string[];
  failed: boolean;
};

function evaluateRule(rule: RatchetRule, eslintFiles: EslintFile[]): RuleOutcome | null {
  const baseline = loadBaselineFor(rule);
  if (!baseline) {
    console.error(`✗ [${rule.rule}] baseline missing at ${rule.baseline}`);
    console.error(`  Seed it with: bun run lint:freeze --rule ${rule.rule} --seed --confirm`);
    process.exit(2);
  }
  const live = countForRule(eslintFiles, rule.rule);
  const liveTotal = Object.values(live).reduce((a, b) => a + b.count, 0);

  const regressedFiles: RuleOutcome["regressedFiles"] = [];
  const newFiles: RuleOutcome["newFiles"] = [];
  const improvedFiles: RuleOutcome["improvedFiles"] = [];
  const clearedFiles: string[] = [];

  for (const [path, report] of Object.entries(live)) {
    const was = baseline.files[path] ?? 0;
    if (was === 0) newFiles.push({ path, now: report.count });
    else if (report.count > was) regressedFiles.push({ path, was, now: report.count });
    else if (report.count < was) improvedFiles.push({ path, was, now: report.count });
  }
  for (const [path] of Object.entries(baseline.files)) {
    if (!(path in live)) clearedFiles.push(path);
  }

  const failed = regressedFiles.length > 0 || newFiles.length > 0 || liveTotal > baseline.total;
  return {
    rule,
    baseline,
    live,
    liveTotal,
    regressedFiles,
    newFiles,
    improvedFiles,
    clearedFiles,
    failed,
  };
}

function reportRule(o: RuleOutcome): void {
  const liveFiles = Object.keys(o.live).length;
  console.log(
    `\n[${o.rule.rule}] live=${o.liveTotal} (${liveFiles} files) | baseline=${o.baseline.total} (${
      Object.keys(o.baseline.files).length
    } files)`,
  );

  if (o.newFiles.length) {
    gha(`::group::${o.rule.rule}: ${o.newFiles.length} new file(s)`);
    console.error(`✗ ${o.newFiles.length} file(s) introduced new violations (not in baseline):`);
    for (const f of o.newFiles) {
      console.error(`    +${f.now}  ${f.path}`);
      for (const loc of o.live[f.path].occurrences) {
        ghaAnnotation(
          "error",
          f.path,
          loc,
          `${o.rule.rule}: new violation in file not in baseline (file total +${f.now}).`,
        );
      }
    }
    gha(`::endgroup::`);
  }
  if (o.regressedFiles.length) {
    gha(`::group::${o.rule.rule}: ${o.regressedFiles.length} regressed file(s)`);
    console.error(`✗ ${o.regressedFiles.length} file(s) regressed:`);
    for (const f of o.regressedFiles) {
      console.error(`    ${f.was} → ${f.now}  ${f.path}`);
      for (const loc of o.live[f.path].occurrences) {
        ghaAnnotation(
          "error",
          f.path,
          loc,
          `${o.rule.rule}: file regressed ${f.was} → ${f.now} (over budget by ${f.now - f.was}).`,
        );
      }
    }
    gha(`::endgroup::`);
  }
  if (o.improvedFiles.length || o.clearedFiles.length) {
    console.log(
      `✓ improvements: ${o.improvedFiles.length} file(s) shrank, ${o.clearedFiles.length} file(s) cleared.`,
    );
    for (const f of o.improvedFiles) {
      ghaAnnotation(
        "notice",
        f.path,
        null,
        `${o.rule.rule}: improved ${f.was} → ${f.now}. Run \`bun run lint:ratchet -- --write\` to lock it in.`,
      );
    }
    for (const path of o.clearedFiles) {
      ghaAnnotation(
        "notice",
        path,
        null,
        `${o.rule.rule}: file cleared (was ${o.baseline.files[path]}). Run \`bun run lint:ratchet -- --write\` to remove from baseline.`,
      );
    }
  }
}

function writeJobSummary(outcomes: RuleOutcome[]) {
  if (!IN_GHA || !process.env.GITHUB_STEP_SUMMARY) return;
  const failing = outcomes.filter((o) => o.failed);
  if (failing.length === 0) return;
  const lines: string[] = [`### ESLint ratchet failed`, ``];
  for (const o of failing) {
    lines.push(`#### ${o.rule.rule}`);
    lines.push(`Live **${o.liveTotal}** vs baseline **${o.baseline.total}**.`);
    if (o.newFiles.length) {
      lines.push(``, `**New files outside baseline**`, `| file | count |`, `| --- | ---: |`);
      for (const f of o.newFiles) lines.push(`| \`${f.path}\` | ${f.now} |`);
    }
    if (o.regressedFiles.length) {
      lines.push(``, `**Regressed files**`, `| file | baseline | live | delta |`, `| --- | ---: | ---: | ---: |`);
      for (const f of o.regressedFiles)
        lines.push(`| \`${f.path}\` | ${f.was} | ${f.now} | +${f.now - f.was} |`);
    }
    lines.push(``);
  }
  lines.push(`Fix: narrow the type / address the rule, or freeze a cleanup with \`bun run lint:freeze --confirm\`.`);
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  } catch {
    // Best effort.
  }
}

function writeBaseline(o: RuleOutcome) {
  // Lower-only merge: never raise any entry beyond its current baseline.
  const merged: Record<string, number> = {};
  for (const [path, report] of Object.entries(o.live)) {
    const was = o.baseline.files[path] ?? Number.POSITIVE_INFINITY;
    merged[path] = Math.min(report.count, was);
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort());
  const newTotal = Object.values(sorted).reduce((a, b) => a + b, 0);
  const next: Baseline = {
    generatedAt: new Date().toISOString(),
    rule: o.rule.rule,
    total: newTotal,
    files: sorted,
  };
  writeFileSync(resolve(ROOT, o.rule.baseline), JSON.stringify(next, null, 2) + "\n");
  console.log(`✓ [${o.rule.rule}] baseline rewritten: ${o.baseline.total} → ${newTotal}`);
}

function main() {
  const config = loadConfig();
  const rules = ONLY_RULE
    ? config.rules.filter((r) => r.rule === ONLY_RULE)
    : config.rules;
  if (rules.length === 0) {
    console.error(`✗ no matching rules${ONLY_RULE ? ` for --rule ${ONLY_RULE}` : ""}`);
    process.exit(2);
  }

  const eslintFiles = runEslintOnce();
  const outcomes = rules
    .map((r) => evaluateRule(r, eslintFiles))
    .filter((o): o is RuleOutcome => o !== null);

  for (const o of outcomes) reportRule(o);

  const anyFailed = outcomes.some((o) => o.failed);
  writeJobSummary(outcomes);

  if (anyFailed) {
    console.error(`\n✗ Blocked: one or more rule budgets exceeded.`);
    process.exit(1);
  }

  if (WRITE) {
    for (const o of outcomes) {
      if (o.improvedFiles.length || o.clearedFiles.length) writeBaseline(o);
    }
  } else {
    const improved = outcomes.some((o) => o.improvedFiles.length || o.clearedFiles.length);
    if (improved) {
      console.log(`\n  Run \`bun run lint:ratchet -- --write\` to lower the affected baselines.`);
    }
    console.log(`\n✓ within budget for ${outcomes.length} rule(s).`);
  }
}

main();
