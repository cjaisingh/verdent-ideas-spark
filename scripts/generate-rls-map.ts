#!/usr/bin/env bun
/**
 * Generates `e2e/rls-policy-map.generated.ts` from `pg_policies` so the e2e
 * RLS matrix tests pull table/RPC posture from a single SQL source-of-truth
 * instead of hand-maintained constants.
 *
 * Connection: uses the standard PG* env vars (PGHOST, PGPORT, PGUSER,
 * PGPASSWORD, PGDATABASE) or `DATABASE_URL` / `SUPABASE_DB_URL`. Falls back
 * to spawning `psql` if the `pg` module isn't available.
 *
 * CI usage:
 *   bun run rls:generate                # regenerate
 *   bun run rls:verify                  # regenerate + git diff (fails if drift)
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

type PolicyRow = {
  tablename: string;
  cmd: string; // SELECT | INSERT | UPDATE | DELETE | ALL
  qual: string | null;
  with_check: string | null;
};

type FunctionRow = {
  fname: string;
  has_role_check: string | null; // e.g. 'admin' | 'operator' | null
};

const POLICY_SQL = `
SELECT tablename, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, cmd
`;

// SECURITY DEFINER functions that contain a self-check on a role — we infer
// the gating role from the function body. Heuristic but stable: matches our
// has_role(auth.uid(), 'X') idiom.
const FN_SQL = `
SELECT p.proname AS fname, pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true
ORDER BY p.proname
`;

function runPsql(sql: string): unknown[] {
  const r = spawnSync(
    "psql",
    ["-At", "-F", "\u0001", "-c", `COPY (${sql.trim().replace(/;$/, "")}) TO STDOUT WITH CSV`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error(`psql failed (${r.status})`);
  }
  // Parse simple CSV (no embedded newlines in our output)
  const lines = r.stdout.split("\n").filter(Boolean);
  return lines.map((l) => parseCsvLine(l));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else cur += c;
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadPolicies(): PolicyRow[] {
  const rows = runPsql(POLICY_SQL) as string[][];
  return rows.map(([tablename, cmd, qual, with_check]) => ({
    tablename,
    cmd,
    qual: qual || null,
    with_check: with_check || null,
  }));
}

function loadFunctions(): FunctionRow[] {
  const rows = runPsql(FN_SQL) as string[][];
  return rows.map(([fname, def]) => {
    const m = def.match(/has_role\([^,]+,\s*'(admin|operator|user)'/);
    return { fname, has_role_check: m ? m[1] : null };
  });
}

// ---------- Derive posture per table ----------

type Role = "anon" | "operator" | "admin";
type Posture = {
  table: string;
  /** Roles that can SELECT (according to USING clause) */
  read: Role[];
  /** Roles that can INSERT (according to WITH CHECK) */
  insert: Role[];
  /** Whether direct client write is fully blocked (USING/WITH CHECK = false) */
  clientWriteBlocked: boolean;
  /** Whether SELECT is gated by `auth.uid() = user_id` (per-row owner) */
  selfRowOnly: boolean;
};

function rolesFromExpr(expr: string | null): Role[] {
  if (!expr) return [];
  if (/^\s*false\s*$/i.test(expr)) return [];
  const roles: Role[] = [];
  if (/has_role\([^,]+,\s*'admin'/i.test(expr)) roles.push("admin");
  if (/has_role\([^,]+,\s*'operator'/i.test(expr)) roles.push("operator");
  // admin policies on user_roles also imply admin can ALL
  return roles;
}

function buildPostures(policies: PolicyRow[]): Posture[] {
  const byTable = new Map<string, PolicyRow[]>();
  for (const p of policies) {
    const arr = byTable.get(p.tablename) ?? [];
    arr.push(p);
    byTable.set(p.tablename, arr);
  }

  const out: Posture[] = [];
  for (const [table, ps] of [...byTable.entries()].sort()) {
    const reads = new Set<Role>();
    const inserts = new Set<Role>();
    let clientWriteBlocked = false;
    let selfRowOnly = false;

    for (const p of ps) {
      const cmds = p.cmd === "ALL" ? ["SELECT", "INSERT", "UPDATE", "DELETE"] : [p.cmd];
      const qualRoles = rolesFromExpr(p.qual);
      const checkRoles = rolesFromExpr(p.with_check);

      // Detect "no client write" sentinel: ALL with USING/CHECK = false
      if (p.cmd === "ALL" && /^\s*false\s*$/i.test(p.qual ?? "") &&
          /^\s*false\s*$/i.test(p.with_check ?? "")) {
        clientWriteBlocked = true;
        continue;
      }

      // Detect per-row owner read (auth.uid() = user_id)
      if (cmds.includes("SELECT") && /auth\.uid\(\)\s*=\s*user_id/i.test(p.qual ?? "")) {
        selfRowOnly = true;
        // Don't add "operator/admin" — readable by row owner only.
      }

      for (const role of qualRoles) {
        if (cmds.includes("SELECT")) reads.add(role);
      }
      for (const role of checkRoles) {
        if (cmds.includes("INSERT")) inserts.add(role);
      }
    }

    // admin is always a superset of operator for our project's policy idiom
    // (admin can do everything operator can via separate `admins manage roles`
    // policies + bootstrap flow). Reflect that here so consumer code is simple.
    if (reads.has("operator")) reads.add("admin");
    if (inserts.has("operator")) inserts.add("admin");

    out.push({
      table,
      read: [...reads].sort(),
      insert: [...inserts].sort(),
      clientWriteBlocked,
      selfRowOnly,
    });
  }
  return out;
}

// ---------- Render generated file ----------

const policies = loadPolicies();
const fns = loadFunctions();
const postures = buildPostures(policies);

const operatorRpcs = fns.filter((f) => f.has_role_check === "operator").map((f) => f.fname).sort();
const adminRpcs = fns.filter((f) => f.has_role_check === "admin").map((f) => f.fname).sort();
const otherRpcs = fns.filter((f) => f.has_role_check === null).map((f) => f.fname).sort();

const banner = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Regenerate with: bun run rls:generate
 * Verify in CI:    bun run rls:verify
 *
 * Source: pg_policies (tables) + pg_proc (SECURITY DEFINER fns) in the live
 * database. The e2e RLS matrix tests import from this file so adding a new
 * table or changing a policy automatically updates the test surface.
 *
 * Generated at: ${new Date().toISOString()}
 */`;

const fileContent =
  `${banner}\n\n` +
  `export type Role = "anon" | "operator" | "admin";\n\n` +
  `export interface TablePosture {\n` +
  `  table: string;\n` +
  `  /** Roles whose SELECT policy USING clause permits read */\n` +
  `  read: Role[];\n` +
  `  /** Roles whose INSERT policy WITH CHECK permits insert */\n` +
  `  insert: Role[];\n` +
  `  /** ALL policy with USING=false / CHECK=false — direct client writes blocked */\n` +
  `  clientWriteBlocked: boolean;\n` +
  `  /** SELECT gated by auth.uid() = user_id (per-row owner read like user_roles) */\n` +
  `  selfRowOnly: boolean;\n` +
  `}\n\n` +
  `export const TABLE_POSTURE: TablePosture[] = ${JSON.stringify(postures, null, 2)};\n\n` +
  `export const ALL_TABLES: string[] = TABLE_POSTURE.map((p) => p.table);\n\n` +
  `/** Tables readable by the operator role (and therefore admin too). */\n` +
  `export const OPERATOR_READ_TABLES: string[] = TABLE_POSTURE\n` +
  `  .filter((p) => p.read.includes("operator"))\n` +
  `  .map((p) => p.table);\n\n` +
  `/** Tables readable ONLY by admin (operator must be denied). */\n` +
  `export const ADMIN_ONLY_READ_TABLES: string[] = TABLE_POSTURE\n` +
  `  .filter((p) => p.read.includes("admin") && !p.read.includes("operator") && !p.selfRowOnly)\n` +
  `  .map((p) => p.table);\n\n` +
  `/** Tables where SELECT is gated to the row owner (auth.uid()=user_id). */\n` +
  `export const SELF_ROW_ONLY_TABLES: string[] = TABLE_POSTURE\n` +
  `  .filter((p) => p.selfRowOnly)\n` +
  `  .map((p) => p.table);\n\n` +
  `/** Tables where direct client INSERT is blocked even for operator (writes via edge fn / triggers). */\n` +
  `export const CLIENT_WRITE_BLOCKED: string[] = TABLE_POSTURE\n` +
  `  .filter((p) => p.clientWriteBlocked || p.insert.length === 0)\n` +
  `  .map((p) => p.table);\n\n` +
  `/** SECURITY DEFINER RPCs gated by has_role(_, 'operator'). */\n` +
  `export const OPERATOR_RPCS: string[] = ${JSON.stringify(operatorRpcs, null, 2)};\n\n` +
  `/** SECURITY DEFINER RPCs gated by has_role(_, 'admin'). */\n` +
  `export const ADMIN_RPCS: string[] = ${JSON.stringify(adminRpcs, null, 2)};\n\n` +
  `/** Other SECURITY DEFINER fns (triggers, has_role itself, bootstrap, etc.). */\n` +
  `export const OTHER_SECDEF_FNS: string[] = ${JSON.stringify(otherRpcs, null, 2)};\n`;

const outPath = "e2e/rls-policy-map.generated.ts";
writeFileSync(outPath, fileContent);
console.log(`Wrote ${outPath} — ${postures.length} tables, ${operatorRpcs.length} operator RPCs, ${adminRpcs.length} admin RPCs`);
