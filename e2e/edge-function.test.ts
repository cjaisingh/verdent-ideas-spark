import { beforeAll, describe, expect, it } from "vitest";
import { callFn, env, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

describe("awip-api — auth", () => {
  it("returns 401 with no auth", async () => {
    const r = await callFn("/capabilities", { auth: "none" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBeTruthy();
  });

  it("returns 401 with garbage JWT", async () => {
    const r = await callFn("/capabilities", { auth: "jwt", jwt: "not-a-real-token" });
    expect(r.status).toBe(401);
  });

  it("operator JWT can read /capabilities", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/capabilities", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.capabilities)).toBe(true);
  });

  it("operator JWT can read /capabilities/demand", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/capabilities/demand", { auth: "jwt", jwt: accessToken });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.demand)).toBe(true);
    expect(Array.isArray(r.body.tenants)).toBe(true);
  });
});

describe("awip-api — service token (cross-project path)", () => {
  it("service token authorizes /capabilities", async () => {
    if (!env.SERVICE_TOKEN) {
      console.warn("E2E_AWIP_SERVICE_TOKEN not set — skipping service-token assertions");
      return;
    }
    const r = await callFn("/capabilities", { auth: "service" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.capabilities)).toBe(true);
  });

  it("wrong service token is rejected", async () => {
    const r = await callFn("/capabilities", {
      headers: { "x-awip-service-token": "wrong-token-" + Date.now() },
    });
    expect(r.status).toBe(401);
  });
});

describe("awip-api — idempotency", () => {
  it("POST /okr/ingest returns identical body on replay with same Idempotency-Key", async () => {
    if (!env.SERVICE_TOKEN) {
      console.warn("E2E_AWIP_SERVICE_TOKEN not set — skipping idempotency test");
      return;
    }
    const slug = `e2e-idem-${Date.now()}`;
    const key = `e2e/${slug}`;
    const body = JSON.stringify({
      tenant_slug: slug,
      tenant_name: `E2E Idem ${slug}`,
      nodes: [
        { client_id: "obj-1", kind: "objective", title: "E2E objective" },
        {
          client_id: "kr-1",
          parent_client_id: "obj-1",
          kind: "key_result",
          title: "E2E KR",
          measurement: { metric_name: "e2e_metric", required_capabilities: [] },
        },
      ],
    });

    const first = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body,
    });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const second = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body,
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});

describe("awip-api — validation", () => {
  it("POST /okr/ingest with missing fields returns 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": `e2e/validation-${Date.now()}` },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });
});
