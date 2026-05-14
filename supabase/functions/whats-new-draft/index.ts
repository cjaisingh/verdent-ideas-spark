// whats-new-draft: scan recent changes (migrations, capability_events, CHANGELOG, new files)
// and produce {title, area, what, why, how_to_use, impact} drafts in whats_new_entries.
//
// Auth: AWIP_SERVICE_TOKEN (cron) OR operator JWT (manual "Scan now" button).
// Idempotent via whats_new_sources (kind, ref) unique key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import { pickModel } from "../_shared/model-policy.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-awip-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const GH_TOKEN = Deno.env.get("GITHUB_REVIEWS_TOKEN") ?? "";

const REPO = "cjaisingh/verdent-ideas-spark";
const MAX_DRAFTS_PER_RUN = 8;

type Source = { kind: string; ref: string; title: string; area: string; ctx: string; meta?: Record<string, unknown> };

async function authorize(req: Request, sb: ReturnType<typeof createClient>): Promise<{ ok: boolean; user_id: string | null }> {
  const svc = req.headers.get("x-awip-service-token");
  if (svc && SERVICE_TOKEN && svc === SERVICE_TOKEN) return { ok: true, user_id: null };
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return { ok: false, user_id: null };
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return { ok: false, user_id: null };
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", data.user.id);
  const ok = (roles ?? []).some((r: { role: string }) => r.role === "operator" || r.role === "admin");
  return { ok, user_id: data.user.id };
}

async function ghJson<T>(path: string): Promise<T | null> {
  if (!GH_TOKEN) return null;
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return null;
  return await r.json() as T;
}

async function collectSources(sb: ReturnType<typeof createClient>): Promise<Source[]> {
  const out: Source[] = [];

  // 1. Recent migrations from GitHub (last 30 commits touching supabase/migrations)
  const commits = await ghJson<Array<{ sha: string; commit: { message: string }; files?: Array<{ filename: string }> }>>(
    "/commits?per_page=30",
  );
  if (commits) {
    for (const c of commits) {
      const detail = await ghJson<{ files?: Array<{ filename: string; patch?: string }> }>(`/commits/${c.sha}`);
      const files = detail?.files ?? [];
      for (const f of files) {
        if (f.filename.startsWith("supabase/migrations/") && f.filename.endsWith(".sql")) {
          out.push({
            kind: "migration", ref: f.filename,
            title: f.filename.split("/").pop()!.replace(/\.sql$/, ""),
            area: "schema",
            ctx: (f.patch ?? "").slice(0, 4000),
            meta: { sha: c.sha, message: c.commit.message },
          });
        } else if (f.filename.startsWith("supabase/functions/") && f.filename.endsWith("index.ts")) {
          const fn = f.filename.split("/")[2];
          out.push({
            kind: "function", ref: fn,
            title: fn, area: "edge",
            ctx: (f.patch ?? "").slice(0, 3000),
            meta: { sha: c.sha, message: c.commit.message },
          });
        } else if (f.filename.startsWith("src/pages/") && f.filename.endsWith(".tsx")) {
          out.push({
            kind: "page", ref: f.filename,
            title: f.filename.split("/").pop()!.replace(/\.tsx$/, ""),
            area: "ui",
            ctx: (f.patch ?? "").slice(0, 2000),
            meta: { sha: c.sha, message: c.commit.message },
          });
        }
      }
    }
  }

  // 2. Recent capability_events (24h)
  const { data: caps } = await sb
    .from("capability_events")
    .select("id, capability_id, event_type, payload, created_at")
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  for (const c of caps ?? []) {
    out.push({
      kind: "capability_event", ref: String(c.id),
      title: `${c.event_type}: ${c.capability_id}`,
      area: "policy",
      ctx: JSON.stringify({ event_type: c.event_type, payload: c.payload }).slice(0, 2000),
    });
  }

  // 3. CHANGELOG.md latest entries (HEAD diff)
  const cl = await ghJson<{ content: string }>("/contents/CHANGELOG.md");
  if (cl?.content) {
    const text = atob(cl.content.replace(/\n/g, ""));
    const sections = text.split(/^## /m).slice(1, 4);
    for (const s of sections) {
      const head = s.split("\n")[0]?.slice(0, 80) ?? "untitled";
      out.push({
        kind: "changelog", ref: head,
        title: head, area: "docs",
        ctx: s.slice(0, 3000),
      });
    }
  }

  return out;
}

async function draftOne(src: Source): Promise<Record<string, string> | null> {
  if (!LOVABLE_API_KEY) return null;
  const model = pickModel("google/gemini-2.5-flash");
  const prompt = `You are documenting a shipped change to the AWIP operator console.
Source kind: ${src.kind}
Source ref: ${src.ref}
Suggested area: ${src.area}

Source context (truncated):
---
${src.ctx}
---

Produce ONE concise change-journal entry as JSON with these fields:
{
  "title": "<6-10 word headline>",
  "area": "schema|edge|ui|cron|policy|docs",
  "what": "<2-3 sentence description of what changed>",
  "why": "<1-2 sentence rationale>",
  "how_to_use": "<1-3 sentence operator-facing usage; or 'No operator action — runs automatically.'>",
  "impact": "<1-2 sentence blast radius and observable effect>"
}
Be terse. UK English. No marketing language. Return JSON only, no prose.`;

  const start = Date.now();
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    await logAiUsage(sb, {
      job: "whats-new-draft", model, trigger: "cron",
      status: "error", status_code: r.status, latency_ms: Date.now() - start,
      error: txt.slice(0, 400), request_ref: { kind: src.kind, ref: src.ref },
    });
    return null;
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content ?? "";
  await logAiUsage(sb, {
    job: "whats-new-draft", model, trigger: "cron",
    status: "ok", status_code: 200, latency_ms: Date.now() - start,
    request_ref: { kind: src.kind, ref: src.ref },
  });
  try {
    const parsed = JSON.parse(content);
    return { ...parsed, model };
  } catch { return null; }
}

Deno.serve(withLogger("whats-new-draft", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const auth = await authorize(req, sb);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sources = await collectSources(sb);
  ctx.attach("sources_seen", sources.length);

  // Filter out already-known refs
  const refs = sources.map((s) => ({ kind: s.kind, ref: s.ref }));
  const refsKey = (r: { kind: string; ref: string }) => `${r.kind}:${r.ref}`;
  const { data: seen } = await sb
    .from("whats_new_sources")
    .select("kind, ref")
    .in("ref", refs.map((r) => r.ref));
  const seenSet = new Set((seen ?? []).map(refsKey));
  const fresh = sources.filter((s) => !seenSet.has(refsKey(s))).slice(0, MAX_DRAFTS_PER_RUN);
  ctx.attach("sources_fresh", fresh.length);

  let drafted = 0;
  for (const src of fresh) {
    const draft = await draftOne(src);
    if (!draft) {
      // record source so we don't retry every 30 min on persistent failures
      await sb.from("whats_new_sources").insert({ kind: src.kind, ref: src.ref, meta: { ...src.meta, draft_failed: true } });
      continue;
    }
    const { data: entry, error: insErr } = await sb
      .from("whats_new_entries")
      .insert({
        title: draft.title ?? src.title,
        area: ["schema", "edge", "ui", "cron", "policy", "docs"].includes(draft.area) ? draft.area : src.area,
        what: draft.what ?? "",
        why: draft.why ?? "",
        how_to_use: draft.how_to_use ?? "",
        impact: draft.impact ?? "",
        source_refs: { [src.kind]: [src.ref], meta: src.meta ?? {} },
        status: "draft",
        created_by: auth.user_id,
        model: draft.model,
        draft_meta: { source: src },
      })
      .select("id")
      .single();
    if (insErr || !entry) continue;
    await sb.from("whats_new_sources").insert({ kind: src.kind, ref: src.ref, entry_id: entry.id, meta: src.meta ?? {} });
    drafted++;
  }

  return new Response(JSON.stringify({
    ok: true, sources_seen: sources.length, fresh: fresh.length, drafted,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}));
