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

describe("/capabilities/demand resolution_warning emission", () => {
  it("emits a resolution_warning for an unknown capability and de-dupes within 10 minutes", async () => {
    if (skipIfNoService()) return;

    const slug = `e2e-resw-${Date.now()}`;
    // Use a capability id that is overwhelmingly unlikely to be registered.
    const unknownCap = `__e2e_unknown_${Date.now()}`;

    const ingest = await callFn("/okr/ingest", {
      method: "POST",
      auth: "service",
      headers: { "idempotency-key": `e2e/resw/${slug}` },
      body: JSON.stringify({
        tenant_slug: slug,
        tenant_name: `ResW ${slug}`,
        nodes: [
          { client_id: "obj-1", kind: "objective", title: "ResW objective" },
          {
            client_id: "kr-1",
            parent_client_id: "obj-1",
            kind: "key_result",
            title: "ResW KR",
            measurement: {
              metric_name: "resw_metric",
              target: 1,
              unit: "x",
              required_capabilities: [unknownCap],
            },
          },
        ],
      }),
    });
    expect(ingest.status).toBe(200);

    // First call should emit a warning.
    const first = await callFn("/capabilities/demand", {
      method: "GET",
      auth: "service",
    });
    expect(first.status).toBe(200);

    const op = await operatorClient();
    const sb = anonClient();
    await sb.auth.setSession({
      access_token: op.accessToken,
      refresh_token: op.accessToken,
    } as any);

    const readWarnings = async () => {
      const { data } = await sb
        .from("capability_events")
        .select("id, payload, created_at")
        .eq("capability_id", unknownCap)
        .eq("event_type", "resolution_warning")
        .order("created_at", { ascending: false });
      return data ?? [];
    };

    const after1 = await readWarnings();
    expect(after1.length).toBeGreaterThanOrEqual(1);
    expect((after1[0].payload as any).reason).toBe("unknown");
    expect((after1[0].payload as any).active_kr_count).toBeGreaterThanOrEqual(1);

    // Second call within 10 minutes should NOT add another row.
    const second = await callFn("/capabilities/demand", { method: "GET", auth: "service" });
    expect(second.status).toBe(200);
    const after2 = await readWarnings();
    expect(after2.length).toBe(after1.length);
  });
});
