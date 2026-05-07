#!/usr/bin/env bun
/**
 * RLS coverage report.
 *
 * Runs the three RLS test files via vitest's JSON reporter, then groups
 * results by table / RPC / role so you can scan regressions at a glance.
 *
 * Usage:
 *   bun run scripts/rls-coverage-report.ts                # writes to stdout + reports/rls-coverage.md
 *   bun run scripts/rls-coverage-report.ts --json         # emit machine-readable JSON to stdout
 *   bun run scripts/rls-coverage-report.ts --out path.md  # custom output path
 *
 * Requires the same env as `bun run test:security` (E2E_SUPABASE_URL etc.).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

type AssertionResult = {
  ancestorTitles: string[];
  fullName: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  failureMessages?: string[];
  duration?: number | null;
};

type TestResult = {
  name: string;
  status: "passed" | "failed" | "skipped";
  assertionResults: AssertionResult[];
};

type VitestJson = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: TestResult[];
};

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : "reports/rls-coverage.md";

const RLS_FILES = [
  "e2e/rls-matrix.test.ts",
  "e2e/rls-role-matrix.test.ts",
  "e2e/security-audit.test.ts",
];

// ---------- Run vitest with JSON reporter ----------

const tmpJson = resolve(".vitest-rls-coverage.json");
if (existsSync(tmpJson)) unlinkSync(tmpJson);

const run = spawnSync(
  "bunx",
  [
    "vitest",
    "run",
    "--config",
    "vitest.e2e.config.ts",
    "--reporter=json",
    `--outputFile=${tmpJson}`,
    ...RLS_FILES,
  ],
  { stdio: ["ignore", "inherit", "inherit"], env: process.env },
);

if (!existsSync(tmpJson)) {
  console.error("\nvitest did not produce a JSON report — aborting");
  process.exit(run.status ?? 1);
}

const report: VitestJson = JSON.parse(readFileSync(tmpJson, "utf8"));
unlinkSync(tmpJson);

// ---------- Classify each assertion ----------

type Subject = { kind: "table" | "rpc" | "other"; name: string };
type Role = "anon" | "operator-only" | "admin" | "operator" | "unknown";

type Row = {
  subject: Subject;
  role: Role;
  action: string; // "read" | "insert" | "rpc" | etc.
  status: AssertionResult["status"];
  fullName: string;
  failureMessage?: string;
  file: string;
};

const KNOWN_RPCS = new Set([
  "has_role",
  "grant_user_role",
  "revoke_user_role",
  "list_users_with_roles",
  "purge_expired_rows",
  "purge_all_rows",
  "retention_stats",
]);

function classify(a: AssertionResult, file: string): Row {
  const title = a.title.toLowerCase();
  const full = a.fullName;

  // role: prefer explicit [bracket] tag from rls-role-matrix
  let role: Role = "unknown";
  const bracketed = a.ancestorTitles.find((t) => /\[(anon|operator-only|admin)\]/.test(t));
  if (bracketed) {
    const m = bracketed.match(/\[(anon|operator-only|admin)\]/)!;
    role = m[1] as Role;
  } else if (/^anon\b/.test(title)) role = "anon";
  else if (/^operator\b/.test(title)) role = "operator";
  else if (/^admin\b/.test(title)) role = "admin";

  // action
  let action = "other";
  if (/\bread\b|select|cannot read|can read/.test(title)) action = "read";
  else if (/\binsert\b|cannot insert|cannot directly insert/.test(title)) action = "insert";
  else if (/\brpc\b|rejected from|can introspect|admin rpcs|operator rpcs|cannot call/.test(title))
    action = "rpc";
  else if (/user_roles/.test(title)) action = "read";

  // subject — try to find a known RPC name first, then fall back to backticked or quoted token
  let subject: Subject = { kind: "other", name: a.title };
  for (const rpc of KNOWN_RPCS) {
    if (title.includes(rpc)) {
      subject = { kind: "rpc", name: rpc };
      break;
    }
  }
  if (subject.kind === "other") {
    // Try to extract a table name (last word in titles like "anon cannot read foo_bar")
    const m =
      a.title.match(/(?:read|insert into|insert|directly insert into)\s+([a-z_][a-z0-9_]*)/i) ??
      a.title.match(/\b([a-z_][a-z0-9_]+)\b\s*$/);
    if (m) subject = { kind: "table", name: m[1] };
  }

  return {
    subject,
    role,
    action,
    status: a.status,
    fullName: full,
    failureMessage: a.failureMessages?.[0]?.split("\n").slice(0, 4).join("\n"),
    file,
  };
}

const rows: Row[] = [];
for (const tr of report.testResults) {
  for (const a of tr.assertionResults) rows.push(classify(a, tr.name));
}

// ---------- Aggregate ----------

const tables = new Map<string, Row[]>();
const rpcs = new Map<string, Row[]>();
const other: Row[] = [];

for (const r of rows) {
  const bucket =
    r.subject.kind === "table" ? tables : r.subject.kind === "rpc" ? rpcs : null;
  if (!bucket) {
    other.push(r);
    continue;
  }
  const arr = bucket.get(r.subject.name) ?? [];
  arr.push(r);
  bucket.set(r.subject.name, arr);
}

const ROLES: Role[] = ["anon", "operator-only", "operator", "admin"];
const TABLE_COLS: { role: Role; action: string; label: string }[] = [
  { role: "anon", action: "read", label: "anon R" },
  { role: "anon", action: "insert", label: "anon W" },
  { role: "operator-only", action: "read", label: "op-only R" },
  { role: "operator", action: "read", label: "op R" },
  { role: "operator", action: "insert", label: "op W" },
  { role: "admin", action: "read", label: "admin R" },
];

function cell(rs: Row[], role: Role, action: string): string {
  const matches = rs.filter((r) => r.role === role && r.action === action);
  if (matches.length === 0) return "·";
  if (matches.some((m) => m.status === "failed")) return "❌";
  if (matches.every((m) => m.status === "skipped")) return "⊘";
  if (matches.every((m) => m.status === "passed")) return "✅";
  return "✅";
}

// ---------- Render ----------

if (jsonMode) {
  const payload = {
    summary: {
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      skipped: report.numPendingTests,
    },
    tables: Object.fromEntries(
      [...tables.entries()].sort().map(([name, rs]) => [
        name,
        Object.fromEntries(TABLE_COLS.map((c) => [c.label, cell(rs, c.role, c.action)])),
      ]),
    ),
    rpcs: Object.fromEntries(
      [...rpcs.entries()].sort().map(([name, rs]) => [
        name,
        Object.fromEntries(ROLES.map((r) => [r, cell(rs, r, "rpc")])),
      ]),
    ),
    failures: rows
      .filter((r) => r.status === "failed")
      .map((r) => ({
        file: r.file,
        fullName: r.fullName,
        subject: r.subject,
        role: r.role,
        action: r.action,
        message: r.failureMessage,
      })),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(report.numFailedTests > 0 ? 1 : 0);
}

const lines: string[] = [];
lines.push("# RLS Coverage Report");
lines.push("");
lines.push(
  `**${report.numPassedTests} passed**, **${report.numFailedTests} failed**, ${report.numPendingTests} skipped (${report.numTotalTests} total)`,
);
lines.push("");
lines.push("Legend: ✅ pass · ❌ fail · ⊘ skipped · · not asserted");
lines.push("");

lines.push("## Table coverage");
lines.push("");
lines.push("| Table | " + TABLE_COLS.map((c) => c.label).join(" | ") + " |");
lines.push("|---|" + TABLE_COLS.map(() => "---").join("|") + "|");
for (const [name, rs] of [...tables.entries()].sort()) {
  lines.push(
    `| \`${name}\` | ` + TABLE_COLS.map((c) => cell(rs, c.role, c.action)).join(" | ") + " |",
  );
}
lines.push("");

lines.push("## RPC coverage");
lines.push("");
lines.push("| RPC | " + ROLES.join(" | ") + " |");
lines.push("|---|" + ROLES.map(() => "---").join("|") + "|");
for (const [name, rs] of [...rpcs.entries()].sort()) {
  lines.push(`| \`${name}\` | ` + ROLES.map((r) => cell(rs, r, "rpc")).join(" | ") + " |");
}
lines.push("");

const failures = rows.filter((r) => r.status === "failed");
if (failures.length) {
  lines.push("## Failures");
  lines.push("");
  for (const f of failures) {
    lines.push(`### ❌ ${f.fullName}`);
    lines.push(`- file: \`${f.file}\``);
    lines.push(`- subject: \`${f.subject.kind}:${f.subject.name}\` · role: \`${f.role}\` · action: \`${f.action}\``);
    if (f.failureMessage) {
      lines.push("```");
      lines.push(f.failureMessage);
      lines.push("```");
    }
    lines.push("");
  }
} else {
  lines.push("## Failures");
  lines.push("");
  lines.push("_None — all asserted role/table/rpc combinations passed._");
  lines.push("");
}

if (other.length) {
  lines.push("## Unclassified assertions");
  lines.push("");
  lines.push("These tests didn't map to a single table/RPC (e.g. linter baseline, multi-table loops):");
  lines.push("");
  for (const o of other) {
    const icon = o.status === "passed" ? "✅" : o.status === "failed" ? "❌" : "⊘";
    lines.push(`- ${icon} \`${o.file}\` — ${o.fullName}`);
  }
  lines.push("");
}

const output = lines.join("\n");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output);
console.log(output);
console.error(`\nWrote ${outPath}`);
process.exit(report.numFailedTests > 0 ? 1 : 0);
