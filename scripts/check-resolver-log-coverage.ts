#!/usr/bin/env -S deno run --allow-read
// s5.2/t5 — CI guard: any edge-function call to `resolve_entity` MUST go
// through `resolve_entity_logged` so every resolution gets logged in
// `resolver_decisions`. Direct `resolve_entity` rpc calls in `supabase/functions/`
// fail the build.
//
// Allowed: `resolve_entity_logged`, `resolve_entity_logged(`, plain SQL files,
// `supabase/migrations/`, `scripts/adr-bench/`, this file itself.

const ROOT = new URL("../", import.meta.url).pathname;
const TARGET = "supabase/functions";
const BAD = /\bresolve_entity\b\s*\(/g;
const ALLOW = /\bresolve_entity_logged\b\s*\(/;

const offenders: Array<{ file: string; line: number; text: string }> = [];

async function walk(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await walk(full);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    const text = await Deno.readTextFile(full);
    if (!BAD.test(text)) continue;
    // re-scan line by line, allow `resolve_entity_logged` on the same line
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!/\bresolve_entity\b\s*\(/.test(ln)) continue;
      if (ALLOW.test(ln)) continue;
      offenders.push({ file: full.replace(ROOT, ""), line: i + 1, text: ln.trim() });
    }
  }
}

await walk(`${ROOT}${TARGET}`);

if (offenders.length > 0) {
  console.error("\n❌ resolver log coverage check failed:");
  console.error("   Edge functions must call resolve_entity_logged, never resolve_entity directly.\n");
  for (const o of offenders) console.error(`   ${o.file}:${o.line}  ${o.text}`);
  console.error("");
  Deno.exit(1);
}

console.log("✓ resolver log coverage: all callers use resolve_entity_logged");
