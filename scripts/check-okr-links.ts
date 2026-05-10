// scripts/check-okr-links.ts
// Reports roadmap tasks in active sprints that have no okr_node_id link.
// Non-blocking until phase-okr Slice 2 wires the gate.
//
// Usage:
//   bun run scripts/check-okr-links.ts            # report only
//   bun run scripts/check-okr-links.ts --strict   # exit 1 if any unlinked

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / key env vars");
  process.exit(2);
}

const sb = createClient(url, key);
const strict = process.argv.includes("--strict");

const { data, error } = await sb
  .from("roadmap_tasks")
  .select("id, key, title, status, okr_node_id, sprint:roadmap_sprints!inner(key, status, phase:roadmap_phases!inner(key, status))")
  .in("status", ["todo", "in_progress", "review"]);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(2);
}

type Row = {
  id: string; key: string; title: string; status: string; okr_node_id: string | null;
  sprint: { key: string; status: string; phase: { key: string; status: string } } | null;
};
const rows = (data ?? []) as unknown as Row[];

const unlinked = rows.filter(r =>
  !r.okr_node_id &&
  r.sprint?.status === "active" &&
  r.sprint?.phase?.status === "active"
);

if (unlinked.length === 0) {
  console.log(`✅ All ${rows.length} open tasks in active sprints have an OKR link (or no active sprint).`);
  process.exit(0);
}

console.log(`⚠️  ${unlinked.length} open task(s) in an active sprint with no okr_node_id:\n`);
for (const r of unlinked) {
  console.log(`  • [${r.sprint?.phase.key}/${r.sprint?.key}/${r.key}] ${r.title}`);
}
console.log(`\n(Total open tasks scanned: ${rows.length})`);

if (strict) process.exit(1);
process.exit(0);
