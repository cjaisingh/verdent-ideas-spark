#!/usr/bin/env -S bun run
/**
 * One-shot backfill: walk historical plans and POST their "Out of scope"
 * footers to plan-footer-ingest. Idempotent (autologger dedupes on source_ref).
 *
 * Usage:
 *   AWIP_SERVICE_TOKEN=... SUPABASE_URL=... bun run scripts/backfill-plan-footers.ts
 *
 * Walks every .md file under .lovable/plan-history/ (if present) and the
 * current .lovable/plan.md, using the file basename as plan_id.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://agzkyzyzopcgeobofjaz.supabase.co";
const TOKEN = process.env.AWIP_SERVICE_TOKEN;
if (!TOKEN) {
  console.error("AWIP_SERVICE_TOKEN required");
  process.exit(1);
}

const ENDPOINT = `${SUPABASE_URL}/functions/v1/plan-footer-ingest`;

async function ingest(planId: string, markdown: string) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-awip-service-token": TOKEN!,
    },
    body: JSON.stringify({ plan_id: planId, plan_markdown: markdown, origin: "core" }),
  });
  const body = await r.json().catch(() => ({}));
  console.log(`[${planId}] status=${r.status} created=${body.created_count ?? 0} skipped=${body.skipped_count ?? 0}`);
}

async function main() {
  const targets: Array<{ id: string; path: string }> = [];

  const historyDir = ".lovable/plan-history";
  if (existsSync(historyDir)) {
    for (const f of await readdir(historyDir)) {
      if (f.endsWith(".md")) targets.push({ id: f.replace(/\.md$/, ""), path: join(historyDir, f) });
    }
  }

  const current = ".lovable/plan.md";
  if (existsSync(current)) {
    targets.push({ id: `plan-${new Date().toISOString().slice(0, 10)}-current`, path: current });
  }

  if (!targets.length) {
    console.log("No plan files found.");
    return;
  }

  for (const t of targets) {
    const md = await readFile(t.path, "utf-8");
    await ingest(t.id, md);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
