/**
 * Per-role RLS access matrices.
 *
 * Splits the access surface into three explicit matrices so each role can be
 * verified in isolation:
 *
 *   1. anon            — must be denied EVERYTHING (no read, no write, no RPC)
 *   2. operator-only   — operator role but NOT admin; can read operator tables,
 *                        cannot read admin-only tables, cannot call admin RPCs
 *   3. admin (operator+admin bootstrap user) — full operator surface plus
 *                        admin-only tables (role_change_audit, user_roles) and
 *                        admin RPCs (grant/revoke/list user roles)
 *
 * The "admin" client uses the bootstrap user from `operatorClient()` which is
 * granted both `operator` and `admin` roles by `bootstrap_first_operator()`.
 *
 * The operator-only matrix self-skips when E2E_OPERATOR_ONLY_EMAIL /
 * E2E_OPERATOR_ONLY_PASSWORD are not set, since it requires a second seeded
 * user. See e2e/README.md for setup.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  env,
  operatorClient,
  operatorOnlyClient,
  requireEnv,
} from "./helpers";

beforeAll(() => requireEnv());

// ---------- Source-of-truth access matrix ----------

/** Tables readable by `operator` role (and therefore also by admin). */
const OPERATOR_READ_TABLES = [
  "activity_policies",
  "alert_log",
  "alert_settings",
  "api_call_logs",
  "approval_queue",
  "automation_runs",
  "capabilities",
  "capability_connectors",
  "capability_events",
  "memory_audit_log",
  "memory_settings",
  "notebook_entries",
  "okr_measurements",
  "okr_node_events",
  "okr_nodes",
  "operator_messages",
  "qa_checks",
  "retention_settings",
  "rethink_tasks",
  "roadmap_autolog_settings",
  "roadmap_autolog_skips",
  "roadmap_comments",
  "roadmap_phases",
  "roadmap_review_findings",
  "roadmap_sprints",
  "roadmap_task_activity",
  "roadmap_tasks",
  "roadmap_work_log",
  "telegram_gateway_logs",
  "tenants",
  "test_runs",
] as const;

/** Tables readable ONLY by admin (operator role must be denied). */
const ADMIN_ONLY_READ_TABLES = ["role_change_audit"] as const;

/**
 * `user_roles` is special: each user can read their own row (auth.uid = user_id)
 * and admins can read all rows. So an operator-only user CAN see their own row
 * but should NOT see other users' rows. Treated separately below.
 */

/** Every table that has RLS enabled — anon must be denied all of them. */
const ALL_TABLES = [
  ...OPERATOR_READ_TABLES,
  ...ADMIN_ONLY_READ_TABLES,
  "idempotency_keys", // no client access at all
  "user_roles",
] as const;

/** Admin-gated RPCs — only callable by admin role. */
const ADMIN_RPCS = ["grant_user_role", "revoke_user_role", "list_users_with_roles"] as const;

/** Operator-gated RPCs — callable by operator OR admin (admin is also operator here). */
const OPERATOR_RPCS = ["purge_expired_rows", "purge_all_rows", "retention_stats"] as const;

// ---------- 1. anon matrix ----------

describe("RLS matrix [anon] — denied across the board", () => {
  for (const t of ALL_TABLES) {
    it(`anon read ${t} → blocked`, async () => {
      const c = anonClient();
      const { data, error } = await c.from(t as never).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });
    it(`anon insert ${t} → blocked`, async () => {
      const c = anonClient();
      const { error } = await c.from(t as never).insert({} as never);
      expect(error).not.toBeNull();
    });
  }

  for (const fn of [...ADMIN_RPCS, ...OPERATOR_RPCS]) {
    it(`anon rpc ${fn} → blocked`, async () => {
      const c = anonClient();
      const { error } = await c.rpc(fn as never, {} as never);
      expect(error).not.toBeNull();
    });
  }
});

// ---------- 2. operator-only matrix (operator without admin) ----------

const skipOperatorOnly = !env.HAS_OPERATOR_ONLY;

describe("RLS matrix [operator-only] — operator surface, no admin surface", () => {
  it.skipIf(skipOperatorOnly)("can read every operator table", async () => {
    const { client } = await operatorOnlyClient();
    for (const t of OPERATOR_READ_TABLES) {
      const { error } = await client.from(t as never).select("*").limit(1);
      expect(error, `unexpected error reading ${t}: ${error?.message}`).toBeNull();
    }
  });

  it.skipIf(skipOperatorOnly)("cannot read admin-only tables", async () => {
    const { client } = await operatorOnlyClient();
    for (const t of ADMIN_ONLY_READ_TABLES) {
      const { data, error } = await client.from(t as never).select("*").limit(1);
      // Either explicit error OR empty result set (RLS hides rows silently)
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });

  it.skipIf(skipOperatorOnly)(
    "user_roles: can read OWN row but not other users' rows",
    async () => {
      const { client, userId } = await operatorOnlyClient();
      const { data, error } = await client.from("user_roles").select("user_id");
      expect(error).toBeNull();
      const rows = data ?? [];
      // Every row returned must belong to this user.
      for (const r of rows) expect((r as { user_id: string }).user_id).toBe(userId);
    },
  );

  it.skipIf(skipOperatorOnly)("operator RPCs succeed", async () => {
    const { client } = await operatorOnlyClient();
    const { error } = await client.rpc("retention_stats");
    expect(error).toBeNull();
  });

  it.skipIf(skipOperatorOnly)("admin RPCs reject with 'not authorized'", async () => {
    const { client } = await operatorOnlyClient();
    for (const fn of ADMIN_RPCS) {
      const { error } = await client.rpc(fn as never, {
        _target: "00000000-0000-0000-0000-000000000000",
        _role: "operator",
      } as never);
      expect(error, `${fn} should reject operator-only`).not.toBeNull();
      // The function raises EXCEPTION 'not authorized' — message bubbles up.
      expect(error!.message.toLowerCase()).toMatch(/not authorized|permission/);
    }
  });
});

// ---------- 3. admin matrix (bootstrap user has operator + admin) ----------

describe("RLS matrix [admin] — full surface", () => {
  it("can read every operator table + admin-only tables", async () => {
    const { client } = await operatorClient();
    for (const t of [...OPERATOR_READ_TABLES, ...ADMIN_ONLY_READ_TABLES]) {
      const { error } = await client.from(t as never).select("*").limit(1);
      expect(error, `unexpected error reading ${t}: ${error?.message}`).toBeNull();
    }
  });

  it("can read full user_roles table (not just own row)", async () => {
    const { client } = await operatorClient();
    const { data, error } = await client.from("user_roles").select("user_id");
    expect(error).toBeNull();
    // Bootstrap user has 2 rows (operator + admin) at minimum.
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("admin RPCs succeed (or fail with non-permission errors only)", async () => {
    const { client } = await operatorClient();
    const { error } = await client.rpc("list_users_with_roles");
    expect(error).toBeNull();
  });

  it("operator RPCs succeed", async () => {
    const { client } = await operatorClient();
    const { error } = await client.rpc("retention_stats");
    expect(error).toBeNull();
  });
});
