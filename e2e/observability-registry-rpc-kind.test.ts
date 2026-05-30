// Verifies the observability_registry.surface_kind check constraint accepts
// 'rpc' (widened 2026-05-30) and that the inserted row round-trips intact.
//
// Requires SUPABASE_SERVICE_ROLE_KEY because observability_registry is
// admin-only RLS.
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env } from "./helpers";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

describe("observability_registry — surface_kind='rpc'", () => {
  if (!SERVICE_KEY) {
    it.skip("requires SUPABASE_SERVICE_ROLE_KEY", () => {});
    return;
  }

  const sb = createClient(env.SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const tag = `e2e-rpc-${crypto.randomUUID().slice(0, 8)}`;
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await sb.from("observability_registry").delete().in("id", createdIds);
    }
  });

  it("accepts an rpc-kind row and persists every column verbatim", async () => {
    const row = {
      surface_kind: "rpc",
      surface_id: tag,
      expected_cadence_minutes: 1440,
      watcher_kinds: ["resolver_no_log_in_window"],
      owner: "e2e",
      declared_in: "e2e/observability-registry-rpc-kind.test.ts",
      notes: "rpc kind constraint smoke test",
    };

    const { data, error } = await sb
      .from("observability_registry")
      .insert(row)
      .select("*")
      .single();

    expect(error, error?.message).toBeNull();
    expect(data).toBeTruthy();
    createdIds.push(data!.id);

    expect(data!.surface_kind).toBe("rpc");
    expect(data!.surface_id).toBe(tag);
    expect(data!.expected_cadence_minutes).toBe(1440);
    expect(data!.watcher_kinds).toEqual(["resolver_no_log_in_window"]);
    expect(data!.owner).toBe("e2e");
    expect(data!.declared_in).toBe("e2e/observability-registry-rpc-kind.test.ts");
    expect(data!.notes).toBe("rpc kind constraint smoke test");

    // Round-trip: a fresh read returns the same shape (not just the RETURNING).
    const { data: reread, error: reErr } = await sb
      .from("observability_registry")
      .select("surface_kind,surface_id,watcher_kinds")
      .eq("id", data!.id)
      .single();
    expect(reErr).toBeNull();
    expect(reread).toEqual({
      surface_kind: "rpc",
      surface_id: tag,
      watcher_kinds: ["resolver_no_log_in_window"],
    });
  });

  it("still rejects an unknown surface_kind (constraint not over-widened)", async () => {
    const { error } = await sb.from("observability_registry").insert({
      surface_kind: "not-a-real-kind",
      surface_id: `${tag}-bogus`,
      expected_cadence_minutes: 60,
      watcher_kinds: ["noop"],
      owner: "e2e",
      declared_in: "e2e/observability-registry-rpc-kind.test.ts",
    });
    expect(error).toBeTruthy();
    // Postgres check_violation → PostgREST surfaces SQLSTATE 23514.
    expect(error!.code).toBe("23514");
  });
});
