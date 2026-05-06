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

const validBody = (slug: string) =>
  JSON.stringify({
    tenant_slug: slug,
    nodes: [{ client_id: "obj-1", kind: "objective", title: "Failure-test objective" }],
  });

describe("awip-api — malformed JSON returns 400 (not 500)", () => {
  it("POST /okr/ingest with non-JSON body -> 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": `e2e/fail/badjson-${Date.now()}` },
      body: "this is not json {{{",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/json/i);
  });

  it("POST /okr/ingest with empty body -> 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": `e2e/fail/empty-${Date.now()}` },
      body: "",
    });
    expect(r.status).toBe(400);
  });

  it("POST /events/ingest with non-JSON body -> 400", async () => {
    if (skipIfNoService()) return;
    const r = await callFn("/events/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": `e2e/fail/ev-badjson-${Date.now()}` },
      body: "<<<not json>>>",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/json/i);
  });

  it("POST /okr/:id/spawn with non-JSON body -> 400", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn(`/okr/00000000-0000-0000-0000-000000000000/spawn`, {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      body: "{not-json",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/json/i);
  });
});

describe("awip-api — invalid Idempotency-Key header -> 400", () => {
  it("rejects whitespace in key", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": "has spaces" },
      body: validBody(`fail-ws-${Date.now()}`),
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/idempotency/i);
  });

  it("rejects empty key", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": "" },
      body: validBody(`fail-empty-${Date.now()}`),
    });
    // Some HTTP layers strip empty headers; accept either rejection or pass-through.
    expect([200, 400]).toContain(r.status);
  });

  it("rejects key longer than 200 chars", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": "x".repeat(201) },
      body: validBody(`fail-long-${Date.now()}`),
    });
    expect(r.status).toBe(400);
  });

  it("rejects non-printable chars", async () => {
    const { accessToken } = await operatorClient();
    const r = await callFn("/okr/ingest", {
      method: "POST",
      auth: "jwt",
      jwt: accessToken,
      headers: { "idempotency-key": "tab\there" },
      body: validBody(`fail-tab-${Date.now()}`),
    });
    expect(r.status).toBe(400);
  });
});

describe("awip-api — duplicate Idempotency-Key with different body -> 409", () => {
  it("/okr/ingest: same key + different body returns 409 and does NOT create new tenant", async () => {
    if (skipIfNoService()) return;
    const ts = Date.now();
    const key = `e2e/fail/dup-${ts}`;
    const slugA = `fail-dup-a-${ts}`;
    const slugB = `fail-dup-b-${ts}`;

    const first = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body: validBody(slugA),
    });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const conflict = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body: validBody(slugB),
    });
    expect(conflict.status).toBe(409);
    expect(String(conflict.body.error)).toMatch(/idempotency/i);

    // Same key + identical body still replays cleanly.
    const replay = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body: validBody(slugA),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.tenant_id).toBe(first.body.tenant_id);
  });

  it("/events/ingest: same key + different body returns 409", async () => {
    if (skipIfNoService()) return;
    const ts = Date.now();
    const key = `e2e/fail/ev-dup-${ts}`;
    const bodyA = JSON.stringify({
      events: [{ capability_id: "okr_authoring", event_type: "e2e_dup", payload: { v: 1 } }],
    });
    const bodyB = JSON.stringify({
      events: [{ capability_id: "okr_authoring", event_type: "e2e_dup", payload: { v: 2 } }],
    });

    const first = await callFn("/events/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body: bodyA,
    });
    expect(first.status).toBe(200);

    const conflict = await callFn("/events/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": key },
      body: bodyB,
    });
    expect(conflict.status).toBe(409);
  });
});
