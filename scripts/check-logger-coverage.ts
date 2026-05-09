#!/usr/bin/env -S bun run
/**
 * Logger coverage check (WS4 acceptance criterion).
 *
 * Walks every edge function under supabase/functions/<name>/index.ts and
 * verifies that the request handler is wrapped with withLogger from
 * _shared/logger.ts. Exit non-zero with a list of unwrapped functions.
 *
 * Allowlist: leading-underscore directories (_shared) and any function whose
 * index.ts starts with `// @logger-exempt: <reason>` are skipped.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";

function listFunctions(): string[] {
  return readdirSync(ROOT)
    .filter((name) => !name.startsWith("_"))
    .filter((name) => {
      try {
        return statSync(join(ROOT, name)).isDirectory();
      } catch {
        return false;
      }
    });
}

const fns = listFunctions();
const missing: string[] = [];
const exempt: string[] = [];

for (const fn of fns) {
  const idx = join(ROOT, fn, "index.ts");
  let src: string;
  try {
    src = readFileSync(idx, "utf8");
  } catch {
    continue; // function with no index.ts — skip
  }

  if (/^\s*\/\/\s*@logger-exempt:/m.test(src)) {
    exempt.push(fn);
    continue;
  }

  const importsLogger =
    /from\s+["']\.\.\/_shared\/logger(?:\.ts)?["']/.test(src) ||
    /from\s+["']\.\.\/_shared\/logger\.ts["']/.test(src);
  const usesWrapper = /\bwithLogger\s*\(/.test(src);

  if (!importsLogger || !usesWrapper) {
    missing.push(fn);
  }
}

console.log(
  `logger-coverage: ${fns.length - missing.length - exempt.length}/${fns.length} wrapped (${exempt.length} exempt)`,
);
if (exempt.length) console.log(`  exempt: ${exempt.join(", ")}`);

if (missing.length === 0) process.exit(0);

console.error("\n❌ Edge functions missing withLogger wrapper:\n");
for (const fn of missing) console.error(`  • supabase/functions/${fn}/index.ts`);
console.error(
  "\nWrap the handler with withLogger from ../_shared/logger.ts, or add `// @logger-exempt: <reason>` at the top of the file.",
);
process.exit(1);
