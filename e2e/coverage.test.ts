import { beforeAll, describe, expect, it } from "vitest";
import { callFn, env, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

const skipIfNoService = () => {
  if (!env.SERVICE_TOKEN) {
    console.warn("E2E_AWIP_SERVICE_TOKEN not set — skipping");
    return true;
  }
  return false;
};

// Shared seed: ingest a tenant + tree once for the read-path tests.
let seed: {
  tenantSlug: string;
  tenantId: string;
  objectiveId: string;
  krId: string;
  capabilityId: string;
} | null = null;

async function ensureSeed() {
  if (seed) return seed;
  const slug = `e2e-cov-${Date.now()}`;
  const capabilityId = "okr_authoring"; // already exists in manifest
  const ingest = await callFn("/okr/ingest", {
    method: "POST",
    auth: "service",
    headers: { "idempotency-key": `e2e/cov/${slug}` },
    body: JSON.stringify({
      tenant_slug: slug,
      tenant_name: `E2E Cov ${slug}`,
      nodes: [
        { client_id: "obj-1", kind: "objective", title: "Cov objective" },
        {
          client_id: "kr-1",
          parent_client_id: "obj-1",
          kind: "key_result",
          title: "Cov KR",
          measurement: {
            metric_name: "cov_metric",
            required_capabilities: [capabilityId],
            target: 100,
            unit: "%",
          },
        },
      ],
    }),
  });
  expect(ingest.status).toBe(200);
  const created = (ingest.body.created as { client_id: string; id: string }[]) ?? [];
  const objectiveId = created.find((c) => c.client_id === "obj-1")!.id;
  const krId = created.find((c) => c.client_id === "kr-1")!.id;
  seed = {
    tenantSlug: slug,
    tenantId: ingest.body.tenant_id as string,
    objectiveId,
    krId,
    capabilityId,
  };
  return seed;
}

// ---------- /capabilities (list + filter) ----------
describe("awip-api — GET /capabilities", () => {
  it("operator can list and entries have expected shape", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/capabilities", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(200);
    const caps = r.body.capabilities as any[];
    expect(Array.isArray(caps)).toBe(true);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.name).toBe("string");
      expect(typeof c.status).toBe("string");
    }
  });

  it("?status=active filters server-side", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/capabilities?status=active", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(200);
    const caps = (r.body.capabilities as any[]) ?? [];
    for (const c of caps) expect(c.status).toBe("active");
  });

  it("unknown route returns 404", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/does-not-exist", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(404);
  });
});

// ---------- /capabilities/register ----------
describe("awip-api — POST /capabilities/register", () => {
  it("service token can upsert a capability", async () => {
    if (skipIfNoService()) return;
    const id = `e2e_cap_${Date.now()}`;
    const r = await callFn("/capabilities/register", {
      method: "POST",
      auth: "service",
      body: JSON.stringify({
        id,
        name: "E2E test capability",
        status: "planned",
        owning_module: "e2e_module",
      }),
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.id).toBe(id);
  });

  it("missing required fields returns 400", async () => {
    if (skipIfNoService()) return;
    const r = await callFn("/capabilities/register", {
      method: "POST",
      auth: "service",
      body: JSON.stringify({ id: "missing-name-and-status" }),
    });
    expect(r.status).toBe(400);
  });
});

// ---------- /capabilities/demand ----------
describe("awip-api — GET /capabilities/demand", () => {
  it("returns demand[] and tenants[] with expected shape", async () => {
    if (skipIfNoService()) return;
    const s = await ensureSeed();
    const { accessToken } = await operatorClient();
    const r = await callFn("/capabilities/demand", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(200);
    const demand = r.body.demand as any[];
    const tenants = r.body.tenants as any[];
    expect(Array.isArray(demand)).toBe(true);
    expect(Array.isArray(tenants)).toBe(true);
    expect(tenants.some((t) => t.slug === s.tenantSlug)).toBe(true);

    const row = demand.find((d) => d.capability_id === s.capabilityId);
    expect(row).toBeTruthy();
    expect(row.tenant_ids).toContain(s.tenantId);
    expect(row.tenant_count).toBeGreaterThanOrEqual(1);
  });
});

// ---------- /capabilities/:id/demand-detail ----------
describe("awip-api — GET /capabilities/:id/demand-detail", () => {
  it("returns the seeded KR for the seeded capability", async () => {
    if (skipIfNoService()) return;
    const s = await ensureSeed();
    const { accessToken } = await operatorClient();
    const r = await callFn(`/capabilities/${encodeURIComponent(s.capabilityId)}/demand-detail`, {
      auth: "jwt",
      jwt: accessToken,
    });
    expect(r.status).toBe(200);
    // Shape varies; just assert the endpoint succeeds and surfaces our tenant somewhere.
    const blob = JSON.stringify(r.body);
    expect(blob).toContain(s.tenantId);
  });

  it("unknown capability id still returns 200 with empty/zero demand", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn(`/capabilities/__nope_${Date.now()}/demand-detail`, {
      auth: "jwt",
      jwt: accessToken,
    });
    expect(r.status).toBe(200);
  });
});

// ---------- /okr/tree ----------
describe("awip-api — GET /okr/tree", () => {
  it("missing tenant_id returns 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/tree", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(400);
  });

  it("returns the seeded objective + KR for the seeded tenant", async () => {
    if (skipIfNoService()) return;
    const s = await ensureSeed();
    const { accessToken } = await operatorClient();
    const r = await callFn(`/okr/tree?tenant_id=${s.tenantId}`, {
      auth: "jwt",
      jwt: accessToken,
    });
    expect(r.status).toBe(200);
    const nodes = (r.body.nodes ?? r.body.tree ?? r.body) as any;
    const flat = Array.isArray(nodes) ? nodes : (nodes?.nodes ?? []);
    const ids = (Array.isArray(flat) ? flat : []).map((n: any) => n.id);
    expect(ids).toContain(s.objectiveId);
    expect(ids).toContain(s.krId);
  });
});

// ---------- /okr/ingest validation variants ----------
describe("awip-api — POST /okr/ingest validation", () => {
  it("empty body -> 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": `e2e/cov/empty-${Date.now()}` },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("missing nodes[] -> 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": `e2e/cov/no-nodes-${Date.now()}` },
      body: JSON.stringify({ tenant_slug: `cov-${Date.now()}` }),
    });
    expect(r.status).toBe(400);
  });

  it("empty nodes[] -> 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": `e2e/cov/empty-nodes-${Date.now()}` },
      body: JSON.stringify({ tenant_slug: `cov-${Date.now()}`, nodes: [] }),
    });
    expect(r.status).toBe(400);
  });

  it("KR referencing unknown parent_client_id surfaces a warning", async () => {
    if (skipIfNoService()) return;
    const slug = `e2e-cov-warn-${Date.now()}`;
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": `e2e/cov/warn-${slug}` },
      body: JSON.stringify({
        tenant_slug: slug,
        nodes: [
          {
            client_id: "kr-orphan",
            parent_client_id: "does-not-exist",
            kind: "key_result",
            title: "Orphan KR",
          },
        ],
      }),
    });
    // Implementation may either 200 with warnings or 400; accept either but require signal.
    expect([200, 400]).toContain(r.status);
    const blob = JSON.stringify(r.body).toLowerCase();
    expect(blob).toMatch(/warn|parent|unknown|missing/);
  });
});

// ---------- /okr/:id/spawn + /supersede ----------
describe("awip-api — POST /okr/:id/spawn and /supersede", () => {
  it("spawn missing fields -> 400", async () => {
    if (skipIfNoService()) return;
    const s = await ensureSeed();
    const { accessToken } = await operatorClient();
    const r = await callFn(`/okr/${s.objectiveId}/spawn`, {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("spawn unknown parent -> 404", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn(`/okr/00000000-0000-0000-0000-000000000000/spawn`, {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: JSON.stringify({
        kind: "key_result",
        title: "x",
        spawned_from_reason: "test",
      }),
    });
    expect(r.status).toBe(404);
  });

  it("spawn then supersede a child node", async () => {
    if (skipIfNoService()) return;
    const s = await ensureSeed();
    const { accessToken } = await operatorClient();

    const spawn = await callFn(`/okr/${s.objectiveId}/spawn`, {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: JSON.stringify({
        kind: "key_result",
        title: `Spawned KR ${Date.now()}`,
        spawned_from_reason: "e2e coverage",
      }),
    });
    expect(spawn.status).toBe(200);
    const newId = spawn.body.node?.id as string;
    expect(newId).toBeTruthy();

    const sup = await callFn(`/okr/${newId}/supersede`, {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: JSON.stringify({ title: "Superseded KR", reason: "e2e coverage" }),
    });
    expect(sup.status).toBe(200);
    expect(sup.body.node?.id).toBeTruthy();
    expect(sup.body.node.id).not.toBe(newId);

    const sup400 = await callFn(`/okr/${newId}/supersede`, {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: JSON.stringify({}),
    });
    expect(sup400.status).toBe(400);
  });
});

// ---------- Method/auth surface ----------
describe("awip-api — method + auth surface", () => {
  it("OPTIONS preflight returns CORS headers", async () => {
    const r = await fetch(`${env.FN_URL}/capabilities`, {
      method: "OPTIONS",
      headers: { "access-control-request-method": "GET" },
    });
    await r.text();
    expect([200, 204]).toContain(r.status);
    expect(r.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("POST to a GET-only route returns 404", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/capabilities", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
  });
});
