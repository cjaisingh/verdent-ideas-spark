#!/usr/bin/env -S bun run
/**
 * Generate a Markdown changelog snippet from the current PR's commits.
 * Writes to stdout; the workflow either appends to CHANGELOG.md or posts a
 * PR comment when CHANGELOG.md is missing.
 *
 * Conventional-commit aware:
 *   feat:     → ### Added
 *   fix:      → ### Fixed
 *   chore:    → ### Changed
 *   refactor: → ### Changed
 *   docs:     → ### Documentation
 *   perf:     → ### Performance
 *   security: → ### Security
 *   test:     → (skipped)
 *
 * Anything else lands in ### Other. Subject is taken from the commit summary;
 * a trailing `(#123)` PR ref is preserved when present.
 */

import { execSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.BASE_REF || "HEAD~10";
const head = process.env.GITHUB_SHA || "HEAD";

const log = execSync(`git log --pretty=format:%s ${base}...${head}`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const buckets: Record<string, string[]> = {
  Added: [],
  Fixed: [],
  Changed: [],
  Performance: [],
  Security: [],
  Documentation: [],
  Other: [],
};

const map: Record<string, keyof typeof buckets> = {
  feat: "Added",
  fix: "Fixed",
  chore: "Changed",
  refactor: "Changed",
  perf: "Performance",
  security: "Security",
  docs: "Documentation",
};

for (const subject of log) {
  const m = subject.match(/^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/);
  if (m && m[1].toLowerCase() === "test") continue;
  const type = m ? m[1].toLowerCase() : "other";
  const text = m ? m[2] : subject;
  const bucket = map[type] ?? "Other";
  buckets[bucket].push(text);
}

const today = new Date().toISOString().slice(0, 10);
const sha = (process.env.GITHUB_SHA || "").slice(0, 7);
const header = `## [Unreleased] — ${today}${sha ? ` (${sha})` : ""}`;

let out = header + "\n\n";
let any = false;
for (const [name, items] of Object.entries(buckets)) {
  if (items.length === 0) continue;
  any = true;
  out += `### ${name}\n`;
  for (const it of items) out += `- ${it}\n`;
  out += "\n";
}

if (!any) {
  console.log("");
  process.exit(0);
}

process.stdout.write(out);
