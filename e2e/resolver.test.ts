// Phase 5 s5.1 — resolver e2e.
// Service-token only (no operator-data setup needed for assertions).
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

const RESOLVE_URL = `${env.SUPABASE_URL}/functions/v1/entity-resolve`;

async function call(path: string, body: unknown, idem?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: env.SUPABASE_ANON_KEY,
    "x-service-token": env.SERVICE_TOKEN,
  };
  if (idem) headers["idempotency-key"] = idem;
  const res = await fetch(`${RESOLVE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json: unknown = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: res.status, body: json as Record<string, unknown> };
}

describe("entity-resolve — s5.1 deterministic path", () => {
  if (!process.env.E2E_AWIP_SERVICE_TOKEN) {
    it.skip("requires E2E_AWIP_SERVICE_TOKEN", () => {});
    return;
  }

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const sb = createClient(
    env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  let nodeA = "";
  let nodeB = "";

  beforeAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn("SUPABASE_SERVICE_ROLE_KEY missing — resolver test skipped");
      return;
    }
    const { data: a } = await sb.from("tenant_nodes").insert({
      tenant_id: tenantA, kind: "site", name: "Acme HQ",
      external_ids: { os_uprn: `UPRN-${tenantA.slice(0, 8)}` },
    }).select("id").single();
    const { data: b } = await sb.from("tenant_nodes").insert({
      tenant_id: tenantB, kind: "site", name: "Acme HQ (other tenant)",
    }).select("id").single();
    nodeA = a!.id; nodeB = b!.id;

    // Active alias on tenantA only.
    await sb.from("tenant_node_aliases").insert({
      tenant_id: tenantA, node_id: nodeA, kind: "name", value: "Acme HQ",
    });
    // Same alias value on tenantB — exact same descriptor must not leak.
    await sb.from("tenant_node_aliases").insert({
      tenant_id: tenantB, node_id: nodeB, kind: "name", value: "Acme HQ",
    });
    // Revoked alias on tenantA.
    await sb.from("tenant_node_aliases").insert({
      tenant_id: tenantA, node_id: nodeA, kind: "asset_code",
      value: "OLD-001", revoked_at: new Date().toISOString(),
    });
  });

  it("alias_exact wins; returns only tenantA node when called with tenantA", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [{ kind: "name", value: "Acme HQ" }],
    });
    expect(r.status).toBe(200);
    const cands = (r.body.candidates as Array<{ nodeId: string; matchSource: string }>) ?? [];
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.nodeId === nodeA)).toBe(true);
    expect(cands[0].matchSource).toBe("alias_exact");
  });

  it("cross-tenant gate: tenantB lookup never returns tenantA's node", async () => {
    const r = await call("/resolve", {
      tenantId: tenantB,
      descriptors: [{ kind: "name", value: "Acme HQ" }],
    });
    expect(r.status).toBe(200);
    const cands = (r.body.candidates as Array<{ nodeId: string }>) ?? [];
    expect(cands.every((c) => c.nodeId === nodeB)).toBe(true);
    expect(cands.some((c) => c.nodeId === nodeA)).toBe(false);
  });

  it("authoritative external_id short-circuits with score 1.0", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [
        { kind: "os_uprn", value: `UPRN-${tenantA.slice(0, 8)}`, authoritative: true },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.authoritativeHit).toBe(true);
    const cands = r.body.candidates as Array<{ score: number }>;
    expect(cands[0].score).toBe(1.0);
  });

  it("revoked alias is invisible", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [{ kind: "asset_code", value: "OLD-001" }],
    });
    expect(r.status).toBe(200);
    const cands = (r.body.candidates as unknown[]) ?? [];
    expect(cands.length).toBe(0);
  });

  it("idempotency-key required on /alias/create", async () => {
    const r = await call("/alias/create", {
      tenantId: tenantA, nodeId: nodeA, kind: "name", value: "Another Name",
    });
    expect(r.status).toBe(400);
  });

  // ---------- s5.2: scoring + ancestry --------------------------------------

  it("s5.2 confidence_band: authoritative hit → auto_bind", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [
        { kind: "os_uprn", value: `UPRN-${tenantA.slice(0, 8)}`, authoritative: true },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.confidenceBand).toBe("auto_bind");
  });

  it("s5.2 confidence_band: alias_exact 'name' at default weight (0.7) → conflict band", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [{ kind: "name", value: "Acme HQ" }],
    });
    expect(r.status).toBe(200);
    expect(r.body.confidenceBand).toBe("conflict");
    const cands = r.body.candidates as Array<{ score: number }>;
    expect(cands[0].score).toBeCloseTo(0.7, 1);
  });

  it("s5.2 confidence_band: no descriptor match → empty + no_match", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [{ kind: "name", value: "Completely Unknown Site XYZ" }],
    });
    expect(r.status).toBe(200);
    expect(r.body.confidenceBand).toBe("no_match");
    const cands = (r.body.candidates as unknown[]) ?? [];
    expect(cands.length).toBe(0);
  });

  it("s5.2 ancestry: materialised ancestry_ids returned (single-node tree includes self)", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [{ kind: "name", value: "Acme HQ" }],
    });
    expect(r.status).toBe(200);
    const cands = r.body.candidates as Array<{ nodeId: string; ancestry: string[] }>;
    expect(cands[0].ancestry).toEqual([cands[0].nodeId]);
  });

  it("s5.2 weights: authoritative external_id beats fts on same node", async () => {
    const r = await call("/resolve", {
      tenantId: tenantA,
      descriptors: [
        { kind: "os_uprn", value: `UPRN-${tenantA.slice(0, 8)}`, authoritative: true },
        { kind: "name", value: "Acme HQ" },
      ],
    });
    expect(r.status).toBe(200);
    const top = (r.body.candidates as Array<{ score: number; matchSource: string }>)[0];
    expect(top.matchSource).toBe("authoritative");
    expect(top.score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// s5.3 M2 — alias lifecycle (revoke / merge / split). Embedding-hint cases
// (#7-#9) stay it.todo until M3.
// ---------------------------------------------------------------------------
describe("entity-resolve — s5.3 alias lifecycle", () => {
  if (!process.env.E2E_AWIP_SERVICE_TOKEN || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    it.skip("requires E2E_AWIP_SERVICE_TOKEN + SUPABASE_SERVICE_ROLE_KEY", () => {});
    return;
  }

  const tenant = crypto.randomUUID();
  const otherTenant = crypto.randomUUID();
  const sb = createClient(
    env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  let nodeA = "", nodeB = "", nodeC = "", otherNode = "";

  beforeAll(async () => {
    const ins = async (tid: string, name: string) => {
      const { data } = await sb.from("tenant_nodes")
        .insert({ tenant_id: tid, kind: "site", name }).select("id").single();
      return data!.id as string;
    };
    nodeA = await ins(tenant, "M2 A");
    nodeB = await ins(tenant, "M2 B");
    nodeC = await ins(tenant, "M2 C (merge target)");
    otherNode = await ins(otherTenant, "M2 other tenant");
  });

  it("alias_revoke_invisible_after — revoked alias no longer matches", async () => {
    const created = await call("/alias/create",
      { tenantId: tenant, nodeId: nodeA, kind: "name", value: `M2 Revoke ${nodeA.slice(0,4)}` },
      `m2-create-revoke-${nodeA}`);
    expect(created.status).toBe(200);
    const aliasId = created.body.alias_id as string;

    const revoked = await call("/alias/revoke",
      { tenantId: tenant, aliasId, reason: "no longer valid" },
      `m2-revoke-${aliasId}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.ok).toBe(true);

    const r = await call("/resolve", {
      tenantId: tenant, descriptors: [{ kind: "name", value: `M2 Revoke ${nodeA.slice(0,4)}` }],
    });
    const cands = (r.body.candidates as Array<{ nodeId: string }>) ?? [];
    expect(cands.find((c) => c.nodeId === nodeA)).toBeUndefined();
  });

  it("alias_revoke_requires_idempotency_key — 400 without, replay returns idempotent", async () => {
    const created = await call("/alias/create",
      { tenantId: tenant, nodeId: nodeA, kind: "name", value: `M2 Idem ${nodeA.slice(0,4)}` },
      `m2-create-idem-${nodeA}`);
    const aliasId = created.body.alias_id as string;

    const noKey = await call("/alias/revoke",
      { tenantId: tenant, aliasId, reason: "x" });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toBe("idempotency_key_required");

    const key = `m2-replay-${aliasId}`;
    const first = await call("/alias/revoke", { tenantId: tenant, aliasId, reason: "x" }, key);
    const replay = await call("/alias/revoke", { tenantId: tenant, aliasId, reason: "x" }, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
  });

  it("alias_merge_redirects_old_ids — both old aliases now resolve to new node", async () => {
    const a1 = (await call("/alias/create",
      { tenantId: tenant, nodeId: nodeA, kind: "name", value: `Merge L ${nodeA.slice(0,4)}` },
      `m2-mc-a1-${nodeA}`)).body.alias_id as string;
    const a2 = (await call("/alias/create",
      { tenantId: tenant, nodeId: nodeB, kind: "name", value: `Merge R ${nodeB.slice(0,4)}` },
      `m2-mc-a2-${nodeB}`)).body.alias_id as string;

    const m = await call("/alias/merge", {
      tenantId: tenant, intoNodeId: nodeC, fromAliasIds: [a1, a2],
      descriptor: { kind: "name", value: `Merged ${nodeC.slice(0,4)}` },
      reason: "operator consolidation",
    }, `m2-merge-${nodeC}`);
    expect(m.status).toBe(200);
    expect(m.body.merge_group_id).toBeTruthy();
    expect((m.body.old_alias_ids as string[]).sort()).toEqual([a1, a2].sort());

    const r = await call("/resolve", {
      tenantId: tenant, descriptors: [{ kind: "name", value: `Merged ${nodeC.slice(0,4)}` }],
    });
    const cands = (r.body.candidates as Array<{ nodeId: string }>) ?? [];
    expect(cands[0]?.nodeId).toBe(nodeC);
  });

  it("alias_merge_rejects_cross_tenant — 422 with no writes", async () => {
    const inTenant = (await call("/alias/create",
      { tenantId: tenant, nodeId: nodeA, kind: "name", value: `XT-A ${nodeA.slice(0,4)}` },
      `m2-xt-a-${nodeA}`)).body.alias_id as string;
    const inOther = (await call("/alias/create",
      { tenantId: otherTenant, nodeId: otherNode, kind: "name", value: `XT-B ${otherNode.slice(0,4)}` },
      `m2-xt-b-${otherNode}`)).body.alias_id as string;

    const m = await call("/alias/merge", {
      tenantId: tenant, intoNodeId: nodeC, fromAliasIds: [inTenant, inOther],
      descriptor: { kind: "name", value: "XT merge" }, reason: "should fail",
    }, `m2-xt-merge-${nodeC}`);
    expect(m.status).toBe(422);
    expect(m.body.error).toBe("cross_tenant_rejected");
  });

  it("alias_split_emits_pair — source revoked, two new aliases superseding it", async () => {
    const src = (await call("/alias/create",
      { tenantId: tenant, nodeId: nodeA, kind: "asset_code", value: `SPLIT-${nodeA.slice(0,6)}` },
      `m2-split-src-${nodeA}`)).body.alias_id as string;

    const s = await call("/alias/split", {
      tenantId: tenant, sourceAliasId: src,
      targets: [
        { nodeId: nodeB, descriptor: { kind: "asset_code", value: `SPLIT-${nodeA.slice(0,6)}-L` } },
        { nodeId: nodeC, descriptor: { kind: "asset_code", value: `SPLIT-${nodeA.slice(0,6)}-R` } },
      ],
      reason: "asset was actually two",
    }, `m2-split-${src}`);
    expect(s.status).toBe(200);
    expect((s.body.new_alias_ids as string[]).length).toBe(2);
    expect(s.body.source_alias_id).toBe(src);
  });
});


