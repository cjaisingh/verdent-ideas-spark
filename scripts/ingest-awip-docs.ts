#!/usr/bin/env bun
/**
 * Walk repo docs and POST them to awip-rag /ingest.
 * Run locally or from CI:  bun scripts/ingest-awip-docs.ts
 *
 * Env:
 *   SUPABASE_URL                 (or VITE_SUPABASE_URL)
 *   AWIP_SERVICE_TOKEN
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const URL_BASE = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const TOKEN = process.env.AWIP_SERVICE_TOKEN;
if (!URL_BASE || !TOKEN) {
  console.error("Missing SUPABASE_URL or AWIP_SERVICE_TOKEN");
  process.exit(1);
}

const ROOTS = ["docs", "README.md", "CHANGELOG.md", ".lovable/plan.md"];
const out: { path: string; title: string; content: string; sha: string }[] = [];

function walk(p: string) {
  const s = statSync(p, { throwIfNoEntry: false } as any);
  if (!s) return;
  if (s.isDirectory()) {
    for (const f of readdirSync(p)) walk(join(p, f));
  } else if (p.endsWith(".md") || p.endsWith(".mdx")) {
    const content = readFileSync(p, "utf8");
    const rel = relative(process.cwd(), p);
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? rel;
    const sha = createHash("sha1").update(content).digest("hex");
    out.push({ path: rel, title, content, sha });
  }
}
for (const r of ROOTS) walk(r);

console.log(`Ingesting ${out.length} docs to ${URL_BASE}/functions/v1/awip-rag/ingest`);
const res = await fetch(`${URL_BASE}/functions/v1/awip-rag/ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-awip-service-token": TOKEN },
  body: JSON.stringify({ docs: out }),
});
const body = await res.json();
console.log(res.status, body);
if (!res.ok) process.exit(1);
