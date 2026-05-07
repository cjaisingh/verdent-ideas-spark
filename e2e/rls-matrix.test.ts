import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

/**
 * Access matrix for every public table + privileged RPC.
 * Source of truth lives here — if a table changes its RLS posture, update this list.
 *
 * - anonReadBlocked: anon SELECT must return error or empty rows.
 * - anonWriteBlocked: anon INSERT must error.
 * - operatorRead: operator JWT SELECT must succeed.
 * - clientWriteBlocked: even operator JWT cannot INSERT (write goes via edge fn).
 */
const TABLES = [
  "activity_policies",
  "alert_log",
  "alert_settings",
  "api_call_logs",
  "approval_queue",
  "automation_runs",
  "capabilities",
  "capability_connectors",
  "capability_events",
  "idempotency_keys",
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
  "role_change_audit",
  "telegram_gateway_logs",
  "tenants",
  "test_runs",
  "user_roles",
] as const;

// Tables where the operator JWT is also blocked from direct INSERT (writes via edge fn / triggers only).
const CLIENT_WRITE_BLOCKED = new Set<string>([
  "alert_log",
  "api_call_logs",
  "approval_queue", // INSERT not granted
  "automation_runs",
  "capabilities",
  "capability_connectors",
  "capability_events",
  "idempotency_keys",
  "okr_measurements",
  "okr_node_events",
  "okr_nodes",
  "operator_messages",
  "roadmap_autolog_skips", // gated by has_role only via INSERT policy — keep in operator-write list below
  "roadmap_task_activity",
  "role_change_audit",
  "telegram_gateway_logs",
  "test_runs",
]);
// Adjust: roadmap_autolog_skips actually allows operator INSERT, so remove.
CLIENT_WRITE_BLOCKED.delete("roadmap_autolog_skips");

describe("RLS matrix — anon is blocked everywhere", () => {
  for (const t of TABLES) {
    it(`anon cannot read ${t}`, async () => {
      const c = anonClient();
      const { data, error } = await c.from(t as never).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });

    it(`anon cannot insert into ${t}`, async () => {
      const c = anonClient();
      const { error } = await c.from(t as never).insert({} as never);
      expect(error).not.toBeNull();
    });
  }
});

describe("RLS matrix — operator JWT can read every operator table", () => {
  for (const t of TABLES) {
    it(`operator can read ${t}`, async () => {
      const { client } = await operatorClient();
      const { error } = await client.from(t as never).select("*").limit(1);
      // role_change_audit is admin-only — bootstrap operator also gets admin, so should still pass.
      expect(error).toBeNull();
    });
  }
});

describe("RLS matrix — direct client writes blocked on managed tables", () => {
  for (const t of CLIENT_WRITE_BLOCKED) {
    it(`operator cannot directly insert into ${t}`, async () => {
      const { client } = await operatorClient();
      const { error } = await client.from(t as never).insert({} as never);
      expect(error).not.toBeNull();
    });
  }
});

/**
 * Privileged RPC matrix.
 * Each function self-checks role and must reject anon. Operator is the bootstrap user
 * (granted both operator + admin), so admin-gated RPCs succeed; we only assert they
 * do not throw a permission error.
 */
const ADMIN_RPCS = ["grant_user_role", "revoke_user_role", "list_users_with_roles"] as const;
const OPERATOR_RPCS = ["purge_expired_rows", "purge_all_rows", "retention_stats"] as const;

describe("RPC matrix — anon cannot call privileged RPCs", () => {
  for (const fn of [...ADMIN_RPCS, ...OPERATOR_RPCS]) {
    it(`anon rejected from ${fn}`, async () => {
      const c = anonClient();
      const { error } = await c.rpc(fn as never, {} as never);
      // Either RPC denies execute, or function raises 'not authorized'.
      expect(error).not.toBeNull();
    });
  }
});

describe("RPC matrix — operator can introspect retention_stats", () => {
  it("retention_stats returns rows for operator", async () => {
    const { client } = await operatorClient();
    const { data, error } = await client.rpc("retention_stats");
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
