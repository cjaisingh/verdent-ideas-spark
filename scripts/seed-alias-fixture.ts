#!/usr/bin/env -S bun run
/**
 * Seed ≥1000 aliases for ADR-0004 bench. Idempotent on the fixture tag.
 *
 * Uses a deterministic tenant pool tagged with `fixture_label='adr-0004-bench'`
 * on the parent tenant_nodes row so it can be cleaned up later without
 * touching real operator data.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/seed-alias-fixture.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const TENANTS = 5;
const NODES_PER_TENANT = 220; // 5 * 220 = 1100 nodes → 1100 aliases

const FIXTURE_TAG = "adr-0004-bench";

async function main() {
  console.log("Checking existing fixture aliases…");
  const { count: existing } = await sb
    .from("tenant_node_aliases")
    .select("id", { head: true, count: "exact" })
    .ilike("value", `${FIXTURE_TAG}/%`);
  if ((existing ?? 0) >= 1000) {
    console.log(`Already ${existing} fixture aliases. Skipping.`);
    return;
  }

  // Deterministic tenant UUIDs derived from fixture tag.
  const tenantIds = Array.from({ length: TENANTS }, (_, i) =>
    `00000000-0000-4adr-8004-${String(i).padStart(12, "0")}`);

  const nodeRows: { id?: string; tenant_id: string; kind: string; name: string; external_ids: Record<string, string> }[] = [];
  for (const tenantId of tenantIds) {
    for (let n = 0; n < NODES_PER_TENANT; n++) {
      nodeRows.push({
        tenant_id: tenantId,
        kind: "site",
        name: `${FIXTURE_TAG} node ${tenantId.slice(-4)}-${n}`,
        external_ids: { fixture: `${FIXTURE_TAG}/${tenantId}/${n}` },
      });
    }
  }

  console.log(`Inserting ${nodeRows.length} tenant_nodes…`);
  const inserted: { id: string; tenant_id: string }[] = [];
  // Chunk to avoid payload limits.
  for (let i = 0; i < nodeRows.length; i += 200) {
    const chunk = nodeRows.slice(i, i + 200);
    const { data, error } = await sb.from("tenant_nodes").insert(chunk).select("id, tenant_id");
    if (error) throw error;
    inserted.push(...(data ?? []));
  }

  console.log(`Inserting ${inserted.length} aliases…`);
  const aliasRows = inserted.map((n, idx) => ({
    tenant_id: n.tenant_id,
    node_id: n.id,
    kind: "name" as const,
    value: `${FIXTURE_TAG}/${n.tenant_id.slice(-4)}/${idx}`,
    source: "fixture",
    authoritative: false,
  }));
  for (let i = 0; i < aliasRows.length; i += 200) {
    const chunk = aliasRows.slice(i, i + 200);
    const { error } = await sb.from("tenant_node_aliases").insert(chunk);
    if (error) throw error;
  }

  console.log(`Done. Seeded ${aliasRows.length} aliases across ${TENANTS} tenants.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
