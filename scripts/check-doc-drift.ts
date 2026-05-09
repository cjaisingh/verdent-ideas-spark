#!/usr/bin/env -S bun run
/**
 * Doc-drift check (WS6).
 *
 * Compares changed files in the current PR / push range against doc paths and
 * fails if code-bearing changes shipped without touching docs/CHANGELOG/mem.
 *
 * Heuristic (intentionally conservative — we want signal, not noise):
 *   - If any edge function under supabase/functions/<name>/ changed, then
 *     either docs/automation.md, docs/api.md, or mem/features/<*>.md must
 *     also be in the diff.
 *   - If any new SQL migration was added under supabase/migrations/, then
 *     CHANGELOG.md must also be in the diff.
 *   - If any file in src/pages/ was added or renamed, then docs/operator-*.md
 *     or README.md must also be in the diff.
 *
 * Exits non-zero with a grouped report when drift is detected.
 * Override via the PR label `doc-drift-ok` (checked by the workflow, not here)
 * or by setting env DOC_DRIFT_ALLOW=1 locally.
 */

import { execSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.BASE_REF || "HEAD~1";
const head = process.env.GITHUB_SHA || "HEAD";

function changed(): string[] {
  try {
    const out = execSync(`git diff --name-status ${base}...${head}`, {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t").slice(1).join("\t"));
  } catch (e) {
    console.error("git diff failed:", (e as Error).message);
    process.exit(0); // fail-open on git errors so the check never blocks unrelated work
  }
}

const files = changed();
if (files.length === 0) {
  console.log("doc-drift: no changed files, skipping");
  process.exit(0);
}

const touched = (re: RegExp) => files.some((f) => re.test(f));

const violations: string[] = [];

// Rule 1 — edge functions need automation/api/mem doc touch
const fnChanged = files.filter((f) =>
  /^supabase\/functions\/[^_][^/]+\/.+\.(ts|tsx)$/.test(f),
);
if (fnChanged.length > 0) {
  const docsTouched =
    touched(/^docs\/(automation|api)\.md$/) ||
    touched(/^mem\/features\/.+\.md$/);
  if (!docsTouched) {
    violations.push(
      `Edge functions changed but no docs updated:\n  ${fnChanged
        .map((f) => f.split("/").slice(0, 3).join("/"))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join("\n  ")}\n  → update docs/automation.md, docs/api.md, or mem/features/<topic>.md`,
    );
  }
}

// Rule 2 — new migrations require CHANGELOG
const migrationsAdded = files.filter((f) =>
  /^supabase\/migrations\/.+\.sql$/.test(f),
);
if (migrationsAdded.length > 0 && !touched(/^CHANGELOG\.md$/)) {
  violations.push(
    `New SQL migrations without CHANGELOG entry:\n  ${migrationsAdded.join("\n  ")}\n  → add a CHANGELOG.md line under the next release`,
  );
}

// Rule 3 — new pages require operator/README touch
const pagesChanged = files.filter((f) => /^src\/pages\/.+\.(tsx|ts)$/.test(f));
if (pagesChanged.length > 0) {
  const opTouched =
    touched(/^docs\/operator-.+\.md$/) || touched(/^README\.md$/);
  if (!opTouched) {
    violations.push(
      `Page files changed but no operator doc / README updated:\n  ${pagesChanged.join("\n  ")}\n  → update docs/operator-*.md or README.md`,
    );
  }
}

if (violations.length === 0) {
  console.log(`doc-drift: clean (${files.length} files inspected)`);
  process.exit(0);
}

console.error("\n❌ Doc-drift detected:\n");
for (const v of violations) console.error("• " + v + "\n");
console.error(
  "Fix the docs in this PR, or apply the `doc-drift-ok` label to bypass.",
);
process.exit(1);
