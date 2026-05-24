// Phase 5 s5.1/t5 — direct DB-level cross-tenant isolation for resolve_entity().
// Complements e2e/resolver.test.ts (which covers the entity-resolve edge fn).
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

describe("resolve_entity() — cross-tenant DB isolation", () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    it.skip("requires SUPABASE_SERVICE_ROLE_KEY", () => {});
    return;
  }

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const sb = createClient(env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const shared = `ACME-${tenantA.slice(0, 6)}`;
  let nodeA = "";
  let nodeB = "";

  beforeAll(async () => {
    const { data: a } = await sb.from("tenant_nodes")
      .insert({ tenant_id: tenantA, kind: "site", name: "Acme HQ A" })
      .select("id").single();
    const { data: b } = await sb.from("tenant_nodes")
      .insert({ tenant_id: tenantB, kind: "site", name: "Acme HQ B" })
      .select("id").single();
    nodeA = a!.id;
    nodeB = b!.id;

    await sb.from("tenant_node_aliases").insert([
      { tenant_id: tenantA, node_id: nodeA, kind: "asset_code", value: shared, normalised: shared.toLowerCase(), source: "test" },
      { tenant_id: tenantB, node_id: nodeB, kind: "asset_code", value: shared, normalised: shared.toLowerCase(), source: "test" },
    ]);
  });

  it("returns tenantA's node for tenantA, never tenantB's", async () => {
    const { data, error } = await sb.rpc("resolve_entity", {
      _tenant_id: tenantA,
      _descriptors: [{ kind: "asset_code", value: shared }],
    });
    expect(error).toBeNull();
    const r = data as { winner_node_id: string | null; strategy: string };
    expect(r.winner_node_id).toBe(nodeA);
    expect(r.winner_node_id).not.toBe(nodeB);
    expect(r.strategy).toBe("exact_authoritative");
  });

  it("returns tenantB's node for tenantB", async () => {
    const { data } = await sb.rpc("resolve_entity", {
      _tenant_id: tenantB,
      _descriptors: [{ kind: "asset_code", value: shared }],
    });
    const r = data as { winner_node_id: string | null };
    expect(r.winner_node_id).toBe(nodeB);
  });

  it("returns no_match for a third unknown tenant", async () => {
    const { data } = await sb.rpc("resolve_entity", {
      _tenant_id: crypto.randomUUID(),
      _descriptors: [{ kind: "asset_code", value: shared }],
    });
    const r = data as { winner_node_id: string | null; strategy: string };
    expect(r.winner_node_id).toBeNull();
    expect(r.strategy).toBe("no_match");
  });

  it("no_descriptors strategy when descriptors empty", async () => {
    const { data } = await sb.rpc("resolve_entity", {
      _tenant_id: tenantA,
      _descriptors: [],
    });
    expect((data as { strategy: string }).strategy).toBe("no_descriptors");
  });
});
