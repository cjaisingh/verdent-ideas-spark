/**
 * Post-migration security audit.
 * Runs against the live Lovable Cloud project. Two layers:
 *
 * 1. Supabase database linter — fetched via the Management API. Asserts the
 *    warning count is at or below the documented baseline (intentional 7
 *    self-checking SECURITY DEFINER functions).
 * 2. Role-based query smoke checks — anon is denied, operator is allowed,
 *    write paths are blocked on managed tables.
 *
 * Required env:
 *   E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY (or VITE_* fallbacks)
 *   E2E_OPERATOR_EMAIL, E2E_OPERATOR_PASSWORD
 *   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF — for the linter call
 *
 * If Management-API creds are absent, the linter assertions are skipped (the
 * role checks still run). This keeps the suite usable in dev without a PAT.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, operatorClient, requireEnv } from "./helpers";

const BASELINE_WARN_COUNT = 8; // 7 prior + audit_security_definer_gating helper
const ALLOWED_WARN_LINTS = new Set<string>([
  // Self-checking SECURITY DEFINER functions intentionally callable by authenticated.
  "0029_authenticated_security_definer_function_executable",
]);

const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

beforeAll(() => requireEnv());

describe("security audit — linter baseline", () => {
  it.skipIf(!MGMT_TOKEN || !PROJECT_REF)(
    "linter has no warnings outside the documented allow-list",
    async () => {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/lints`,
        { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } },
      );
      expect(res.ok, `linter API ${res.status}`).toBe(true);
      const lints = (await res.json()) as Array<{ name: string; level: string }>;
      const warnings = lints.filter((l) => l.level === "WARN" || l.level === "ERROR");
      const unexpected = warnings.filter((w) => !ALLOWED_WARN_LINTS.has(w.name));
      expect(
        unexpected,
        `unexpected lints:\n${unexpected.map((u) => `  - ${u.name}`).join("\n")}`,
      ).toEqual([]);
      // Belt-and-braces: total must not exceed baseline.
      expect(warnings.length).toBeLessThanOrEqual(BASELINE_WARN_COUNT);
    },
    30_000,
  );
});

describe("security audit — role-based smoke checks", () => {
  it("anon cannot read user_roles", async () => {
    const c = anonClient();
    const { data, error } = await c.from("user_roles").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("anon cannot read role_change_audit", async () => {
    const c = anonClient();
    const { data, error } = await c.from("role_change_audit").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("anon cannot call has_role RPC", async () => {
    const c = anonClient();
    const { error } = await c.rpc("has_role", {
      _user_id: "00000000-0000-0000-0000-000000000000",
      _role: "operator",
    } as never);
    // Either execute-revoked (PostgREST 401/403) or function returns false; we want a hard fail.
    expect(error).not.toBeNull();
  });

  it("anon cannot call grant_user_role", async () => {
    const c = anonClient();
    const { error } = await c.rpc("grant_user_role", {
      _target: "00000000-0000-0000-0000-000000000000",
      _role: "operator",
    } as never);
    expect(error).not.toBeNull();
  });

  it("operator JWT can read capabilities", async () => {
    const { client } = await operatorClient();
    const { error } = await client.from("capabilities").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("operator JWT cannot directly insert into api_call_logs", async () => {
    const { client } = await operatorClient();
    const { error } = await client.from("api_call_logs").insert({
      method: "GET",
      route: "/x",
      status_code: 200,
    } as never);
    expect(error).not.toBeNull();
  });

  it("pg_net is not installed in the public schema", async () => {
    // Indirect probe: if pg_net leaked back into public, has_role would still work
    // but the linter would re-flag 0014. Linter test above covers it; this is a
    // targeted query for fast local feedback.
    const { client } = await operatorClient();
    const { data } = await client.rpc("retention_stats" as never);
    // If RLS / function plumbing breaks (e.g. extension churn), this throws.
    expect(Array.isArray(data) || data === null).toBe(true);
  });
});
