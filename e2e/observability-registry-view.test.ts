// Integration test for v_observability_registry_status.
//
// Validates the C1 detector contract:
//   1. cron surfaces hydrate from BOTH cron.job_run_details (via
//      observability_cron_last_seen()) AND automation_runs.job, unioned.
//   2. edge_fn surfaces hydrate from edge_request_logs.
//   3. 'table' surfaces are hard-listed (resolver_decisions today). Unknown
//      table surface_ids fall through to status='unknown' — they must NOT be
//      reported as 'stale'.
//   4. Surface kinds outside (cron, edge_fn, table) — i.e. 'agent' — always
//      resolve to 'unknown' regardless of cadence/last_seen.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (bypasses admin-only RLS on the registry
// + lets us seed automation_runs which has FORCE DENY for clients).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env } from "./helpers";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

describe("v_observability_registry_status — detector view", () => {
  if (!SERVICE_KEY) {
    it.skip("requires SUPABASE_SERVICE_ROLE_KEY", () => {});
    return;
  }

  const sb = createClient(env.SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Use a per-run prefix so parallel/repeat runs don't collide with each other
  // or with real registry rows.
  const tag = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  const fixtures = {
    cronViaCronSchema: "sentinel-tick", // real pg_cron job, asserts the cron_cron branch
    cronViaAutomation: `${tag}-cron-from-automation`,
    edgeFn: `${tag}-edge-fn`,
    tableKnown: "resolver_decisions", // only hard-listed table today
    tableUnknown: `${tag}-table-unknown`,
    agent: `${tag}-agent`,
  };

  const registryIds: string[] = [];

  beforeAll(async () => {
    // 1. Seed the registry rows we own. surface_id is namespaced by `tag` so we
    //    can't collide with the real `sentinel-tick`/`resolver_decisions` rows.
    //    For those two we DON'T insert — we read the existing registered row.
    const ownedSeeds = [
      {
        surface_kind: "cron",
        surface_id: fixtures.cronViaAutomation,
        expected_cadence_minutes: 60,
        watcher_kinds: ["five_xx_spike"],
        owner: "e2e",
        declared_in: "e2e/observability-registry-view.test.ts",
      },
      {
        surface_kind: "edge_fn",
        surface_id: fixtures.edgeFn,
        expected_cadence_minutes: 60,
        watcher_kinds: ["five_xx_spike"],
        owner: "e2e",
        declared_in: "e2e/observability-registry-view.test.ts",
      },
      {
        surface_kind: "table",
        surface_id: fixtures.tableUnknown,
        expected_cadence_minutes: 1440,
        watcher_kinds: ["table_inserts"],
        owner: "e2e",
        declared_in: "e2e/observability-registry-view.test.ts",
      },
      {
        surface_kind: "agent",
        surface_id: fixtures.agent,
        expected_cadence_minutes: 60,
        watcher_kinds: ["five_xx_spike"],
        owner: "e2e",
        declared_in: "e2e/observability-registry-view.test.ts",
      },
    ];

    const { data: seeded, error: seedErr } = await sb
      .from("observability_registry")
      .insert(ownedSeeds)
      .select("id");
    if (seedErr) throw new Error(`registry seed failed: ${seedErr.message}`);
    registryIds.push(...(seeded ?? []).map((r) => r.id));

    // 2. For the cron_automation branch, insert a recent automation_runs row
    //    keyed off the namespaced surface_id.
    const { error: arErr } = await sb.from("automation_runs").insert({
      job: fixtures.cronViaAutomation,
      trigger: "manual",
      status: "ok",
      status_code: 200,
      duration_ms: 12,
    });
    if (arErr) throw new Error(`automation_runs seed failed: ${arErr.message}`);
  });

  afterAll(async () => {
    if (registryIds.length) {
      await sb.from("observability_registry").delete().in("id", registryIds);
    }
    await sb.from("automation_runs").delete().eq("job", fixtures.cronViaAutomation);
  });

  async function readStatus(surface_kind: string, surface_id: string) {
    const { data, error } = await sb
      .from("v_observability_registry_status")
      .select("surface_kind,surface_id,status,last_seen_at,expected_cadence_minutes")
      .eq("surface_kind", surface_kind)
      .eq("surface_id", surface_id)
      .maybeSingle();
    if (error) throw new Error(`view read failed: ${error.message}`);
    return data;
  }

  it("cron surface hydrates from cron.job_run_details via observability_cron_last_seen()", async () => {
    // `sentinel-tick` runs every 15min; if last_seen_at is null here, the
    // SECURITY DEFINER helper is silently dropping rows — which is the exact
    // pre-fix bug we're guarding against.
    const row = await readStatus("cron", fixtures.cronViaCronSchema);
    expect(row, "registry must already contain sentinel-tick").toBeTruthy();
    expect(row!.last_seen_at).not.toBeNull();
    expect(["ok", "stale"]).toContain(row!.status); // 'ok' on a healthy bus
    // Sanity: helper must agree with the view's last_seen_at
    const { data: rpc, error: rpcErr } = await sb
      .rpc("observability_cron_last_seen");
    expect(rpcErr).toBeNull();
    const direct = (rpc as Array<{ jobname: string; last_seen_at: string }>)
      .find((r) => r.jobname === fixtures.cronViaCronSchema);
    expect(direct?.last_seen_at).toBeTruthy();
  });

  it("cron surface hydrates from automation_runs.job branch of the union", async () => {
    const row = await readStatus("cron", fixtures.cronViaAutomation);
    expect(row).toBeTruthy();
    // Only signal for this surface_id is the automation_runs row we just
    // inserted — pg_cron has no job by this name. If last_seen_at is null,
    // the cron_automation branch isn't wired into cron_last.
    expect(row!.last_seen_at).not.toBeNull();
    const ageMs = Date.now() - new Date(row!.last_seen_at as string).getTime();
    expect(ageMs).toBeLessThan(60_000);
    expect(row!.status).toBe("ok");
  });

  it("known 'table' surface (resolver_decisions) resolves from its source table", async () => {
    const row = await readStatus("table", fixtures.tableKnown);
    expect(row).toBeTruthy();
    // Status may be 'ok' or 'stale' depending on resolver traffic, but it
    // must NOT be 'unknown' — the hard-listed branch must produce a value.
    expect(row!.status).not.toBe("unknown");
  });

  it("unknown 'table' surface (not hard-listed) falls through to status='unknown'", async () => {
    const row = await readStatus("table", fixtures.tableUnknown);
    expect(row).toBeTruthy();
    expect(row!.last_seen_at).toBeNull();
    // Critical: a table surface we don't know how to read MUST NOT be
    // reported as 'stale' (that would re-create the C1 false-positive noise).
    expect(row!.status).toBe("unknown");
  });

  it("'agent' surface kind always resolves to 'unknown'", async () => {
    const row = await readStatus("agent", fixtures.agent);
    expect(row).toBeTruthy();
    expect(row!.status).toBe("unknown");
  });

  it("edge_fn surface with no recent traffic resolves to 'stale' (last_seen null branch)", async () => {
    const row = await readStatus("edge_fn", fixtures.edgeFn);
    expect(row).toBeTruthy();
    // No edge_request_logs row will exist for our synthetic function name, so
    // the `last_seen IS NULL AND kind IN (cron, edge_fn)` clause fires.
    expect(row!.last_seen_at).toBeNull();
    expect(row!.status).toBe("stale");
  });
});
