/**
 * Per-role RLS access matrices.
 *
 * The table/RPC surface is pulled from `rls-policy-map.generated.ts`, which
 * is generated from `pg_policies` + `pg_proc` by `bun run rls:generate`.
 * CI runs `bun run rls:verify` to fail if the generated file drifts from the
 * live schema, so adding a new table or changing a policy automatically
 * updates the test surface — no manual constants to maintain here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  env,
  operatorClient,
  operatorOnlyClient,
  requireEnv,
} from "./helpers";
import {
  ADMIN_ONLY_READ_TABLES,
  ADMIN_RPCS,
  ALL_TABLES,
  OPERATOR_READ_TABLES,
  OPERATOR_RPCS,
  SELF_ROW_ONLY_TABLES,
} from "./rls-policy-map.generated";
import { INSERT_FIXTURES, isRlsDenial } from "./rls-fixtures";

beforeAll(() => requireEnv());

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

// ---------- 2. operator-only matrix ----------

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
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });

  it.skipIf(skipOperatorOnly || !SELF_ROW_ONLY_TABLES.includes("user_roles"))(
    "self-row tables: only own rows visible",
    async () => {
      const { client, userId } = await operatorOnlyClient();
      for (const t of SELF_ROW_ONLY_TABLES) {
        const { data, error } = await client.from(t as never).select("user_id");
        expect(error).toBeNull();
        for (const r of data ?? [])
          expect((r as { user_id: string }).user_id).toBe(userId);
      }
    },
  );

  it.skipIf(skipOperatorOnly)("operator RPCs succeed", async () => {
    const { client } = await operatorOnlyClient();
    for (const fn of OPERATOR_RPCS) {
      // purge_all_rows requires a table arg — skip its happy-path here, just
      // confirm it doesn't reject with 'not authorized'.
      if (fn === "purge_all_rows") continue;
      const { error } = await client.rpc(fn as never, {} as never);
      if (error) expect(error.message.toLowerCase()).not.toMatch(/not authorized/);
    }
  });

  it.skipIf(skipOperatorOnly)("admin RPCs reject with 'not authorized'", async () => {
    const { client } = await operatorOnlyClient();
    for (const fn of ADMIN_RPCS) {
      const { error } = await client.rpc(fn as never, {
        _target: "00000000-0000-0000-0000-000000000000",
        _role: "operator",
      } as never);
      expect(error, `${fn} should reject operator-only`).not.toBeNull();
      expect(error!.message.toLowerCase()).toMatch(/not authorized|permission/);
    }
  });
});

// ---------- 3. admin matrix ----------

describe("RLS matrix [admin] — full surface", () => {
  it("can read every operator table + admin-only tables", async () => {
    const { client } = await operatorClient();
    for (const t of [...OPERATOR_READ_TABLES, ...ADMIN_ONLY_READ_TABLES]) {
      const { error } = await client.from(t as never).select("*").limit(1);
      expect(error, `unexpected error reading ${t}: ${error?.message}`).toBeNull();
    }
  });

  it("can read full self-row tables (not just own row)", async () => {
    const { client } = await operatorClient();
    for (const t of SELF_ROW_ONLY_TABLES) {
      const { data, error } = await client.from(t as never).select("user_id");
      expect(error).toBeNull();
      // Bootstrap user has at least 2 rows in user_roles.
      if (t === "user_roles") expect((data ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("admin RPCs succeed", async () => {
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
