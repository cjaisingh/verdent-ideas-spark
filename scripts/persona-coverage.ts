#!/usr/bin/env -S bun run
/**
 * Persona coverage check — verifies that every persona under
 * docs/agents/team/ is referenced from AGENTS.md and that the
 * binding map in mem/preferences/verify-completion.md is in sync.
 *
 * Output schema (stable — Lane 10 contract):
 *   {
 *     personas: Array<{ slug: string; path: string }>;
 *     agents_md_refs: string[];           // slugs referenced from AGENTS.md
 *     verify_map_refs: string[];          // slugs cited in verify-completion.md
 *     missing_in_agents_md: string[];     // persona files not linked from AGENTS.md
 *     missing_in_verify_map: string[];    // persona files not cited in verify-completion
 *     orphan_refs: string[];              // references to non-existent personas
 *     status: "ok" | "drift";
 *   }
 *
 * Exit code is 0 when status="ok", 1 when status="drift". Safe to wire into CI.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TEAM_DIR = "docs/agents/team";
const AGENTS_MD = "AGENTS.md";
const VERIFY_MAP = "mem/preferences/verify-completion.md";

type Report = {
  personas: Array<{ slug: string; path: string }>;
  agents_md_refs: string[];
  verify_map_refs: string[];
  missing_in_agents_md: string[];
  missing_in_verify_map: string[];
  orphan_refs: string[];
  status: "ok" | "drift";
};

function listPersonas(): Array<{ slug: string; path: string }> {
  return readdirSync(TEAM_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ slug: f.replace(/\.md$/, ""), path: join(TEAM_DIR, f) }));
}

function extractSlugs(haystack: string, slugs: string[]): string[] {
  const hits = new Set<string>();
  for (const slug of slugs) {
    const re = new RegExp(`\\b${slug.replace(/-/g, "\\-")}\\b`);
    if (re.test(haystack)) hits.add(slug);
  }
  return Array.from(hits).sort();
}

function main(): Report {
  const personas = listPersonas();
  const slugs = personas.map((p) => p.slug);

  const agentsBody = readFileSync(AGENTS_MD, "utf8");
  const verifyBody = readFileSync(VERIFY_MAP, "utf8");

  const agents_md_refs = extractSlugs(agentsBody, slugs);
  const verify_map_refs = extractSlugs(verifyBody, slugs);

  const missing_in_agents_md = slugs.filter((s) => !agents_md_refs.includes(s));
  const missing_in_verify_map = slugs.filter((s) => !verify_map_refs.includes(s));

  // Orphan refs: any token that looks like a persona path but no file matches.
  const orphanRe = /docs\/agents\/team\/([a-z0-9-]+)\.md/g;
  const orphan_refs = Array.from(
    new Set(
      [...agentsBody.matchAll(orphanRe), ...verifyBody.matchAll(orphanRe)]
        .map((m) => m[1])
        .filter((slug) => !slugs.includes(slug)),
    ),
  ).sort();

  const status: Report["status"] =
    missing_in_agents_md.length === 0 &&
    missing_in_verify_map.length === 0 &&
    orphan_refs.length === 0
      ? "ok"
      : "drift";

  return {
    personas,
    agents_md_refs,
    verify_map_refs,
    missing_in_agents_md,
    missing_in_verify_map,
    orphan_refs,
    status,
  };
}

if (import.meta.main) {
  const report = main();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === "ok" ? 0 : 1);
}
