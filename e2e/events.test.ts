import { beforeAll, describe, expect, it } from "vitest";
import { callFn, env, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

describe("awip-api — /events ingest + recent under RLS", () => {
  it("ingests events via service token, then operator JWT reads them back via /events/recent", async () => {
    if (!env.SERVICE_TOKEN) {
      console.warn("E2E_AWIP_SERVICE_TOKEN not set — skipping events ingest test");
      return;
    }

    const marker = `e2e-events-${Date.now()}`;
    const since = new Date(Date.now() - 5_000).toISOString();
    const events = [
      { capability_id: "okr_authoring", event_type: "e2e_test", payload: { marker, n: 1 } },
      { capability_id: "okr_authoring", event_type: "e2e_test", payload: { marker, n: 2 } },
    ];

    // 1. Ingest via service token
    const ingest = await callFn("/events/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": `e2e/${marker}` },
      body: JSON.stringify({ events }),
    });
    expect(ingest.status).toBe(200);
    expect(ingest.body.ok).toBe(true);
    expect(ingest.body.inserted).toBe(2);
    const ids = ingest.body.ids as string[];
    expect(ids).toHaveLength(2);

    // 2. Idempotent replay returns identical body
    const replay = await callFn("/events/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": `e2e/${marker}` },
      body: JSON.stringify({ events }),
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(ingest.body);

    // 3. Read back as operator JWT (RLS path: operators read capability_events)
    const { accessToken } = await operatorClient();
    const recent = await callFn(`/events/recent?limit=200&since=${encodeURIComponent(since)}`, {
      auth: "jwt",
      jwt: accessToken,
    });
    expect(recent.status).toBe(200);
    const found = (recent.body.events as any[]).filter(
      (e) => e.source === "capability" && e.payload?.marker === marker,
    );
    expect(found).toHaveLength(2);
    for (const id of ids) expect(found.some((e) => e.id === id)).toBe(true);
  });

  it("anonymous (no auth) cannot call /events/recent", async () => {
    const r = await callFn("/events/recent", { auth: "none" });
    expect(r.status).toBe(401);
  });

  it("/events/ingest rejects empty body with 400", async () => {
    if (!env.SERVICE_TOKEN) return;
    const r = await callFn("/events/ingest", {
      method: "POST",
      auth: "service",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });
});
