#!/usr/bin/env bun
// Defence-in-depth scrubber for CI e2e artefacts.
//
// `emitDiag` in `e2e/diag.ts` already redacts payloads before writing
// `E2E_DIAG …` lines, but the surrounding raw test output (vitest banners,
// stack traces, fetch error bodies) is not under that contract. This script
// runs the same redaction module against:
//
//   1. `e2e-logs/raw.log`               → rewritten in place, scrubbed
//   2. `e2e-logs/diagnostics.jsonl`     → re-parsed, re-redacted, rewritten
//
// so neither the GitHub step summary (which reads diagnostics.jsonl) nor the
// uploaded artefact (which contains raw.log) can leak a secret even if a new
// test path forgets to call `emitDiag`.
//
// Usage:  bun scripts/scrub-e2e-logs.ts [logs-dir]
//   default logs-dir = e2e-logs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { __testing__ } from "../e2e/diag";

const { scrubString, redact } = __testing__;

const dir = process.argv[2] ?? "e2e-logs";
const rawPath = join(dir, "raw.log");
const jsonlPath = join(dir, "diagnostics.jsonl");

let scrubbedLines = 0;
let scrubbedJsonl = 0;

if (existsSync(rawPath)) {
  const raw = readFileSync(rawPath, "utf8");
  const cleaned = raw
    .split("\n")
    .map((line) => {
      const out = scrubString(line);
      if (out !== line) scrubbedLines++;
      return out;
    })
    .join("\n");
  writeFileSync(rawPath, cleaned, "utf8");
}

if (existsSync(jsonlPath)) {
  const out: string[] = [];
  const lines = readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // Re-run every field through the redactor. Strings get value-pattern
      // scrubbing, objects get key+value scrubbing.
      const reRedacted = redact(obj) as Record<string, unknown>;
      const serialised = JSON.stringify(reRedacted);
      if (serialised !== line) scrubbedJsonl++;
      out.push(serialised);
    } catch {
      // Non-JSON line — fall back to string scrub so nothing leaks.
      const cleaned = scrubString(line);
      if (cleaned !== line) scrubbedJsonl++;
      out.push(cleaned);
    }
  }
  writeFileSync(jsonlPath, out.join("\n") + (out.length ? "\n" : ""), "utf8");
}

// eslint-disable-next-line no-console
console.log(
  `[scrub-e2e-logs] raw.log lines modified: ${scrubbedLines}; diagnostics.jsonl records modified: ${scrubbedJsonl}`,
);
