/**
 * Verifies every SECURITY DEFINER function in the public schema is either
 *   1. a trigger (called only via row events, not directly by users), or
 *   2. carries an authz check — `has_role(...)`, `auth.uid() IS NULL` guard,
 *      or an explicit `RAISE EXCEPTION 'not authorized'`,
 *   3. or is on the documented allow-list below (low-risk read-only or
 *      primitive helpers used by other gated functions).
 *
 * Also asserts the Supabase linter pipeline reports ZERO ERROR-level findings.
 *
 * Required env: standard e2e (`requireEnv`) + optional `SUPABASE_ACCESS_TOKEN`
 * + `SUPABASE_PROJECT_REF` for the linter call (skipped when absent).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { operatorClient, requireEnv } from "./helpers";

/**
 * SECURITY DEFINER functions that are intentionally non-gated.
 * Document why each is safe; never add to this list without justification.
 */
const ALLOWED_NON_GATED = new Set<string>([
  // Primitive role/auth helpers — gating would be circular.
  "has_role",
  "is_principal_allowed",
  "is_workstream_locked",

  // Read-only schema introspection. Cannot exfiltrate row data.
  "db_list_tables",
  "db_list_columns",
  "db_list_all_columns",

  // Maintenance: ANALYZE only, no data exposure.
  "db_analyze_public",

  // Strict SELECT-only validator with regex deny-list and statement_timeout.
  "run_capability_sql_check",

  // Cron-only retention purge; reads memory_settings flag, no user input.
  "auto_purge_if_enabled",

  // Internal helper invoked by sentinel-tick (service token) and triggers.
  "auto_link_finding_to_action",

  // Returns count scoped via `auth.uid()` — implicit per-user gating.
  "sentinel_triage_unacked_count",
]);

const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

beforeAll(() => requireEnv());

type AuditRow = { proname: string; is_trigger: boolean; has_authz_check: boolean };

describe("SECURITY DEFINER gating", () => {
  it("every public SECURITY DEFINER function is trigger / gated / allow-listed", async () => {
    const { client } = await operatorClient();
    const { data, error } = await client.rpc("audit_security_definer_gating" as never);
    expect(error, error?.message).toBeNull();
    const rows = (data ?? []) as AuditRow[];
    expect(rows.length).toBeGreaterThan(0);

    const offenders = rows.filter(
      (r) => !r.is_trigger && !r.has_authz_check && !ALLOWED_NON_GATED.has(r.proname),
    );
    expect(
      offenders,
      "SECURITY DEFINER functions that are neither triggers, authz-gated, nor allow-listed:\n" +
        offenders.map((o) => `  - ${o.proname}`).join("\n"),
    ).toEqual([]);
  });

  it("anon cannot call audit_security_definer_gating", async () => {
    const { anonClient } = await import("./helpers");
    const c = anonClient();
    const { error } = await c.rpc("audit_security_definer_gating" as never);
    expect(error).not.toBeNull();
  });
});

describe("Linter pipeline", () => {
  it.skipIf(!MGMT_TOKEN || !PROJECT_REF)(
    "reports zero ERROR-level findings",
    async () => {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/lints`,
        { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } },
      );
      expect(res.ok, `linter API ${res.status}`).toBe(true);
      const lints = (await res.json()) as Array<{ name: string; level: string; title?: string }>;
      const errors = lints.filter((l) => l.level === "ERROR");
      expect(
        errors,
        "ERROR-level linter findings:\n" +
          errors.map((e) => `  - ${e.name}${e.title ? ` (${e.title})` : ""}`).join("\n"),
      ).toEqual([]);
    },
    30_000,
  );
});
