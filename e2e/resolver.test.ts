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
// s5.3 — alias lifecycle + embedding-hint. Stubbed as `it.todo` until handlers
// land in Milestone 2/3. Each todo names the exact behaviour to assert; the
// stub block keeps the contract visible in vitest output.
// ---------------------------------------------------------------------------
describe("entity-resolve — s5.3 alias lifecycle + embedding-hint", () => {
  it.todo("alias_revoke_invisible_after — revoked alias no longer matches in /resolve");
  it.todo("alias_revoke_requires_idempotency_key — 400 without key, replay returns same body");
  it.todo("alias_hard_revoke_requires_admin_role — operator 403, admin 200, event row carries hard_revoke=true");
  it.todo("alias_merge_redirects_old_ids — both old alias_ids resolve to new canonical node");
  it.todo("alias_merge_rejects_cross_tenant — 422 + no row written");
  it.todo("alias_split_emits_pair — one alias → two; old superseded, two new visible, two events emitted");
  it.todo("embedding_hint_caps_at_0_6 — embedding-only candidate score never exceeds 0.6");
  it.todo("embedding_hint_skipped_when_authoritative_hits — no embed call when authoritative or alias_exact already hit");
  it.todo("embedding_hint_skipped_when_topk_full — no embed call when byNode.size >= topK");
});

