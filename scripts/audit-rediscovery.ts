// scripts/audit-rediscovery.ts
//
// Phase 6 prep — rediscovery audit (s6.1 item 8 in the lane plan).
//
// Mines `ai_usage_log` for repeated near-identical queries per consumer over
// the last 30 days. The output ranks AGENT SURFACES (job field) by likely
// rediscovery cost — i.e. surfaces where the same context is being re-fetched
// and re-fed to the model on every run. These surfaces are the strongest
// candidates for a dedicated retrieval store under whatever shape they
// declared in `public.retrieval_contracts`.
//
// This script is intentionally STORE-AGNOSTIC. It produces ranked evidence,
// not store recommendations. Pick stores later, after eyeballing the report.
//
// Runs read-only against the Lovable Cloud DB via the env-injected service
// role key (PGHOST / PGUSER / PGPASSWORD / SUPABASE_SERVICE_ROLE_KEY etc).
// Writes:  docs/phase-6-rediscovery-audit.md
//
// Usage:
//   deno run -A scripts/audit-rediscovery.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Writing empty report and exiting 0 so CI doesn't break on first run.");
  await Deno.writeTextFile(
    "docs/phase-6-rediscovery-audit.md",
    `# Phase 6 rediscovery audit\n\n_Not run — missing env._\n`,
  );
  Deno.exit(0);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type UsageRow = {
  job: string;
  model: string;
  prompt_tokens: number | null;
  total_tokens: number | null;
  request_ref: Record<string, unknown> | null;
  created_at: string;
};

const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

const { data, error } = await sb
  .from("ai_usage_log")
  .select("job, model, prompt_tokens, total_tokens, request_ref, created_at")
  .gte("created_at", since)
  .limit(50_000);

if (error) {
  console.error("Query failed:", error.message);
  Deno.exit(1);
}

const rows: UsageRow[] = (data ?? []) as UsageRow[];

type Bucket = {
  job: string;
  calls: number;
  totalPromptTokens: number;
  totalTokens: number;
  distinctRefs: Set<string>;
  models: Set<string>;
};

const byJob = new Map<string, Bucket>();
for (const r of rows) {
  const b = byJob.get(r.job) ?? {
    job: r.job,
    calls: 0,
    totalPromptTokens: 0,
    totalTokens: 0,
    distinctRefs: new Set<string>(),
    models: new Set<string>(),
  };
  b.calls += 1;
  b.totalPromptTokens += r.prompt_tokens ?? 0;
  b.totalTokens += r.total_tokens ?? 0;
  b.models.add(r.model);
  // Use the stable shape of request_ref (its sorted keys) as the rediscovery
  // fingerprint. Identical fingerprint across many calls = identical setup
  // context = likely rediscovery.
  const fp = r.request_ref
    ? JSON.stringify(Object.keys(r.request_ref).sort())
    : "∅";
  b.distinctRefs.add(fp);
  byJob.set(r.job, b);
}

type Ranked = Bucket & { rediscoveryScore: number; avgPromptTokens: number };
const ranked: Ranked[] = [...byJob.values()].map((b) => ({
  ...b,
  avgPromptTokens: b.calls === 0 ? 0 : Math.round(b.totalPromptTokens / b.calls),
  // High calls × high avg prompt × low distinct fingerprints = rediscovery hotspot.
  rediscoveryScore:
    b.calls === 0
      ? 0
      : Math.round(
          (b.calls * (b.totalPromptTokens / b.calls)) /
            Math.max(1, b.distinctRefs.size),
        ),
}));
ranked.sort((a, b) => b.rediscoveryScore - a.rediscoveryScore);

// Join with retrieval_contracts to see who has declared a shape already.
const { data: decls } = await sb
  .from("retrieval_contracts")
  .select("consumer, shape, store, status");
const declByConsumer = new Map<string, { shape: string; store: string; status: string }>();
for (const d of (decls ?? []) as { consumer: string; shape: string; store: string; status: string }[]) {
  declByConsumer.set(d.consumer, { shape: d.shape, store: d.store, status: d.status });
}

const lines: string[] = [];
lines.push(`# Phase 6 rediscovery audit`);
lines.push(``);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Window: last 30 days. Sample: ${rows.length} ai_usage_log rows across ${ranked.length} jobs.`);
lines.push(``);
lines.push(`Ranked by rediscovery score = \`calls × avg_prompt_tokens ÷ distinct_request_ref_shapes\`. Higher = more likely the same context is being re-fetched every run.`);
lines.push(``);
lines.push(`This is evidence, not a store recommendation. Pair the top entries with their declared retrieval shape (right-most column) — those are the surfaces where building the matching store first will pay back fastest.`);
lines.push(``);
lines.push(`| Rank | Job | Calls | Avg prompt tokens | Distinct request shapes | Rediscovery score | Declared shape | Status |`);
lines.push(`|---:|---|---:|---:|---:|---:|---|---|`);

const TOP_N = 25;
ranked.slice(0, TOP_N).forEach((r, i) => {
  const decl = declByConsumer.get(r.job);
  lines.push(
    `| ${i + 1} | \`${r.job}\` | ${r.calls} | ${r.avgPromptTokens} | ${r.distinctRefs.size} | ${r.rediscoveryScore.toLocaleString()} | ${decl ? `\`${decl.shape}\`` : "_undeclared_" } | ${decl?.status ?? "—"} |`,
  );
});

lines.push(``);
lines.push(`## Undeclared surfaces with non-trivial volume`);
lines.push(``);
const undeclared = ranked.filter((r) => !declByConsumer.has(r.job) && r.calls >= 5);
if (undeclared.length === 0) {
  lines.push(`_None._`);
} else {
  lines.push(`| Job | Calls | Avg prompt tokens |`);
  lines.push(`|---|---:|---:|`);
  undeclared.slice(0, 25).forEach((r) => {
    lines.push(`| \`${r.job}\` | ${r.calls} | ${r.avgPromptTokens} |`);
  });
  lines.push(``);
  lines.push(`These are the next candidates for a row in \`public.retrieval_contracts\`.`);
}

lines.push(``);
lines.push(`## How to read this`);
lines.push(``);
lines.push(`- **High score, declared \`prose\`:** classic RAG already in place; check chunk freshness window before adding a second store.`);
lines.push(`- **High score, declared \`hierarchical-doc\`:** strong candidate for PageIndex-style ToC retrieval (s6.1/t2).`);
lines.push(`- **High score, declared \`tabular\`:** point the agent at a SQL contract instead of feeding rows-as-text.`);
lines.push(`- **High score, declared \`graph\`:** GraphRAG traversal contract before vector store.`);
lines.push(`- **High score, undeclared:** declare a row first — \`mem://preferences/retrieval-shapes\` rule.`);
lines.push(``);

await Deno.writeTextFile("docs/phase-6-rediscovery-audit.md", lines.join("\n"));
console.log(`Wrote docs/phase-6-rediscovery-audit.md (${ranked.length} jobs ranked).`);
