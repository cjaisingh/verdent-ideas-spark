import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, callFn, env, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

const skipIfNoService = () => {
  if (!env.SERVICE_TOKEN) {
    console.warn("E2E_AWIP_SERVICE_TOKEN not set — skipping");
    return true;
  }
  return false;
};

// Realistic-shaped secrets that should trip our redactor.
const FAKE_OPENAI = "sk-FAKE1234567890ABCDEF1234567890";
const FAKE_BEARER = "Bearer abc.DEF-ghi_jkl1234567890";
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpYXQiOjE3MDAwMDAwMDB9.signaturepart_ABCDEF";

describe("secret redaction in logs and event payloads", () => {
  it("scrubs sk-, Bearer and JWT tokens from request_summary and event payloads", async () => {
    if (skipIfNoService()) return;

    const slug = `e2e-redact-${Date.now()}`;
    // Bury secrets inside data_sources notes and node description — payload paths that get persisted.
    const ingest = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": `e2e/redact/${slug}` },
      body: JSON.stringify({
        tenant_slug: slug,
        tenant_name: `Redact ${slug}`,
        nodes: [
          {
            client_id: "obj-1",
            kind: "objective",
            title: "Redact objective",
            description: `prelude ${FAKE_OPENAI} mid ${FAKE_BEARER} tail`,
          },
          {
            client_id: "kr-1",
            parent_client_id: "obj-1",
            kind: "key_result",
            title: "Redact KR",
            measurement: {
              metric_name: "redact_metric",
              target: 1,
              unit: "x",
              data_sources: [{ kind: "billing", notes: `token=${FAKE_JWT}` }],
            },
          },
        ],
      }),
    });
    expect(ingest.status).toBe(200);
    const tenantId = ingest.body.tenant_id as string;

    // Read back via operator JWT to check api_call_logs + okr_node_events.
    const op = await operatorClient();
    const sb = anonClient();
    await sb.auth.setSession({
      access_token: op.accessToken,
      refresh_token: op.accessToken,
    } as any);

    const { data: logs } = await sb
      .from("api_call_logs")
      .select("request_summary, response_summary, error")
      .eq("route", "/okr/ingest")
      .order("created_at", { ascending: false })
      .limit(20);
    const logsBlob = JSON.stringify(logs ?? []);
    expect(logsBlob).not.toContain(FAKE_OPENAI);
    expect(logsBlob).not.toContain(FAKE_JWT);
    // "Bearer " followed by the secret part — we accept the word "Bearer" alone elsewhere.
    expect(logsBlob).not.toContain("abc.DEF-ghi_jkl1234567890");

    const { data: evs } = await sb
      .from("okr_node_events")
      .select("payload")
      .eq("tenant_id", tenantId);
    const evsBlob = JSON.stringify(evs ?? []);
    expect(evsBlob).not.toContain(FAKE_OPENAI);
    expect(evsBlob).not.toContain(FAKE_JWT);
    expect(evsBlob).not.toContain("abc.DEF-ghi_jkl1234567890");
  });
});
