// AWIP knowledge base: ingest + search
// POST /ingest  { docs: [{ path, title, content, sha? }] }   (service token only)
// POST /search  { q, limit?, agent? }                         (operator JWT or service token)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-awip-service-token, x-copilot-agent",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// Split markdown into ~1.2k char chunks anchored on headings.
function chunk(md: string): { heading: string | null; content: string; ord: number }[] {
  const lines = md.split("\n");
  const out: { heading: string | null; content: string; ord: number }[] = [];
  let cur: string[] = [];
  let heading: string | null = null;
  let ord = 0;
  const flush = () => {
    const text = cur.join("\n").trim();
    if (text.length < 20) { cur = []; return; }
    // hard-split if too long
    const max = 1400;
    for (let i = 0; i < text.length; i += max) {
      out.push({ heading, content: text.slice(i, i + max), ord: ord++ });
    }
    cur = [];
  };
  for (const ln of lines) {
    const m = ln.match(/^(#{1,3})\s+(.*)$/);
    if (m) { flush(); heading = m[2].trim(); continue; }
    cur.push(ln);
  }
  flush();
  return out;
}

async function authorize(req: Request): Promise<{ kind: "service" } | { kind: "operator"; uid: string } | null> {
  const svc = req.headers.get("x-awip-service-token");
  if (svc && svc === SERVICE_TOKEN) return { kind: "service" };
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles?.some((r) => r.role === "operator" || r.role === "admin")) return null;
  return { kind: "operator", uid: data.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/awip-rag/, "") || "/";

  const who = await authorize(req);
  if (!who) return json({ error: "unauthorized" }, 401);

  try {
    if (path === "/ingest" && req.method === "POST") {
      if (who.kind !== "service") return json({ error: "service token required" }, 403);
      const body = await req.json();
      const docs: { path: string; title: string; content: string; sha?: string }[] = body.docs ?? [];
      if (!Array.isArray(docs) || docs.length === 0) return json({ error: "docs[] required" }, 400);

      let upserted = 0, chunks = 0;
      for (const d of docs) {
        if (!d.path || !d.title || !d.content) continue;
        const { data: doc, error: e1 } = await admin.from("awip_docs").upsert(
          { path: d.path, title: d.title, sha: d.sha ?? null, source: "repo", updated_at: new Date().toISOString() },
          { onConflict: "path" },
        ).select("id").single();
        if (e1 || !doc) continue;
        await admin.from("awip_doc_chunks").delete().eq("doc_id", doc.id);
        const rows = chunk(d.content).map((c) => ({ doc_id: doc.id, ...c }));
        if (rows.length) {
          const { error: e2 } = await admin.from("awip_doc_chunks").insert(rows);
          if (!e2) chunks += rows.length;
        }
        upserted++;
      }
      return json({ ok: true, upserted, chunks });
    }

    if (path === "/search" && req.method === "POST") {
      const { q, limit } = await req.json();
      if (!q || typeof q !== "string") return json({ error: "q required" }, 400);
      const lim = Math.min(Math.max(Number(limit ?? 6), 1), 20);

      // websearch_to_tsquery handles natural-language queries; rank with ts_rank.
      const { data, error } = await admin.rpc("awip_rag_search", { _q: q, _limit: lim });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, results: data ?? [] });
    }

    if (path === "/scope-map" && (req.method === "GET" || req.method === "POST")) {
      // Optional filter: ?slug=lovable  or  body { slug }
      let slug: string | null = url.searchParams.get("slug");
      if (!slug && req.method === "POST") {
        try { slug = (await req.json())?.slug ?? null; } catch { /* no body */ }
      }

      let agentsQ = admin
        .from("copilot_agents")
        .select("slug,name,wake_word,enabled,max_risk,allowed_capability_ids,allowed_tables")
        .order("order", { ascending: true });
      if (slug) agentsQ = agentsQ.eq("slug", slug);
      const { data: agents, error: aErr } = await agentsQ;
      if (aErr) return json({ error: aErr.message }, 500);

      // Capability metadata for everything any returned agent can call.
      const capIds = Array.from(new Set((agents ?? []).flatMap((a) => a.allowed_capability_ids ?? [])));
      const { data: caps } = capIds.length
        ? await admin.from("capabilities").select("id,name,status,version,owning_module").in("id", capIds)
        : { data: [] as any[] };
      const capMap = new Map((caps ?? []).map((c) => [c.id, c]));

      // Table physical sizes / row counts for context.
      const { data: tables } = await admin.rpc("db_list_tables");
      const tableMap = new Map((tables ?? []).map((t: any) => [t.table_name, t]));

      const RISK_RANK = { low: 1, medium: 2, high: 3 } as const;
      const result = (agents ?? []).map((a) => ({
        slug: a.slug,
        name: a.name,
        wake_word: a.wake_word,
        enabled: a.enabled,
        max_risk: a.max_risk,
        max_risk_rank: RISK_RANK[a.max_risk as keyof typeof RISK_RANK] ?? 0,
        capabilities: (a.allowed_capability_ids ?? []).map((id: string) => ({
          id,
          ...(capMap.get(id) ?? { unknown: true }),
        })),
        tables: (a.allowed_tables ?? []).map((t: string) => ({
          name: t,
          ...(tableMap.get(t) ?? { unknown: true }),
        })),
        counts: {
          capabilities: (a.allowed_capability_ids ?? []).length,
          tables: (a.allowed_tables ?? []).length,
        },
      }));

      return json({
        ok: true,
        risk_ranks: RISK_RANK,
        generated_at: new Date().toISOString(),
        agents: result,
      });
    }

    return json({ error: "not_found", path }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
