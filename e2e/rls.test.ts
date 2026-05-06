import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

describe("RLS — reads", () => {
  it("anonymous client cannot read tenants", async () => {
    const c = anonClient();
    const { data, error } = await c.from("tenants").select("id").limit(1);
    // PostgREST returns either an error or an empty array under RLS deny.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("anonymous client cannot read api_call_logs", async () => {
    const c = anonClient();
    const { data, error } = await c.from("api_call_logs").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("operator JWT can read tenants", async () => {
    const { client } = await operatorClient();
    const { data, error } = await client.from("tenants").select("id, slug, name").limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("operator JWT can read capabilities", async () => {
    const { client } = await operatorClient();
    const { data, error } = await client
      .from("capabilities")
      .select("id, name, status")
      .limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("RLS — writes are blocked from clients", () => {
  it("operator client cannot directly insert into okr_nodes (must go through edge fn)", async () => {
    const { client } = await operatorClient();
    const { error } = await client.from("okr_nodes").insert({
      tenant_id: "00000000-0000-0000-0000-000000000000",
      kind: "objective",
      title: "rls-write-attempt",
    });
    expect(error).not.toBeNull();
  });

  it("operator client cannot directly insert into idempotency_keys", async () => {
    const { client } = await operatorClient();
    const { error } = await client.from("idempotency_keys").insert({
      key: "x",
      scope: "x",
      response: {},
    });
    expect(error).not.toBeNull();
  });
});
