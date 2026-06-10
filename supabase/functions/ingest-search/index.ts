// W9.0 — ingest-search
// Operator queries ingested chunks scoped to one engagement (+ optional
// domain filter). Embeds the query via Lovable AI Gateway and calls
// public.match_ingested_chunks_enriched.
// Hierarchical mode (default): 2x match_count, then de-duplicate so at
// most 3 chunks per file are returned. Also resolves entity_refs into
// EntityContext and OkrContext cross-references.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import {
  IngestSearchBody,
  type IngestSearchResponse,
  type IngestSearchHit,
} from "../_shared/contracts/ingest-file.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMBED_MODEL = "google/gemini-embedding-001";
const EMBED_DIMS = 1536;

/** Helper: embed one or more strings. Returns the first embedding vector. */
async function embedBatch(texts: string[], apiKey: string): Promise<{ vec: number[]; tokens: number }> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIMS }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error("embed_failed"), { status: res.status, detail: text.slice(0, 300) });
  }
  const data = await res.json();
  const vec: number[] | undefined = data?.data?.[0]?.embedding;
  const tokens: number = data?.usage?.prompt_tokens ?? 0;
  if (!vec) throw new Error("embed_empty");
  return { vec, tokens };
}

// ---------- context types (local — not yet in contract file) ----------

type EntityContext = {
  id: string;
  name: string;
  status: string | null;
};

type OkrContext = {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  current_value: number | null;
  target_value: number | null;
};

// ---------- enriched hit shape from match_ingested_chunks_enriched ----------

type RawEnrichedHit = {
  file_id: string;
  filename: string;
  chunk_id: string | null;
  chunk_index: number;
  chunk_type: string | null;
  section_id: string | null;
  content: string;
  similarity: number;
  domain_id: string | null;
  entity_refs: string[] | null;
  metadata: Record<string, unknown>;
};

Deno.serve(withLogger("ingest-search", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) return json({ error: "ai_gateway_not_configured" }, 503);

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

  if (!isService) {
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
    const uid = u.user.id;
    const { data: isOp } = await userClient.rpc("has_role", { _user_id: uid, _role: "operator" });
    const { data: isAd } = await userClient.rpc("has_role", { _user_id: uid, _role: "admin" });
    if (!isOp && !isAd) return json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = IngestSearchBody.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;

  // Hierarchical defaults to true unless caller explicitly sets it false.
  const hierarchical: boolean = (p as unknown as Record<string, unknown>).hierarchical !== false;
  const entity_ids: string[] | undefined = (p as unknown as Record<string, unknown>).entity_ids as string[] | undefined;
  const chunk_types: string[] | undefined = (p as unknown as Record<string, unknown>).chunk_types as string[] | undefined;

  // Embed query.
  let vec: number[];
  let qTokens: number;
  try {
    const result = await embedBatch([p.query], LOVABLE_API_KEY);
    vec = result.vec;
    qTokens = result.tokens;
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number; detail?: string };
    if (e.message === "embed_empty") return json({ error: "embed_empty" }, 502);
    return json({ error: "embed_failed", status: e.status, detail: e.detail }, 502);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Hierarchical mode doubles the fetch count so we can de-duplicate by file.
  const fetchCount = hierarchical ? p.match_count * 2 : p.match_count;

  const { data: rawHits, error: mErr } = await sb.rpc("match_ingested_chunks_enriched", {
    query_embedding: vec as unknown as string,
    p_engagement_id: p.engagement_id,
    p_domain_ids: p.domain_ids ?? null,
    match_count: fetchCount,
  });

  if (mErr) return json({ error: "search_failed", detail: mErr.message }, 500);

  let hits: RawEnrichedHit[] = rawHits ?? [];

  // Apply optional chunk_type filter.
  if (chunk_types && chunk_types.length > 0) {
    hits = hits.filter((h) => h.chunk_type && chunk_types.includes(h.chunk_type));
  }

  // Apply optional entity_ids filter (keep hits that reference any of the requested entities).
  if (entity_ids && entity_ids.length > 0) {
    hits = hits.filter((h) =>
      Array.isArray(h.entity_refs) && h.entity_refs.some((ref) => entity_ids.includes(ref))
    );
  }

  // Hierarchical de-duplication: max 3 chunks per file, preserving similarity order.
  if (hierarchical) {
    const countByFile = new Map<string, number>();
    hits = hits.filter((h) => {
      const count = countByFile.get(h.file_id) ?? 0;
      if (count >= 3) return false;
      countByFile.set(h.file_id, count + 1);
      return true;
    });
    // Trim back to the originally requested match_count after de-dup.
    hits = hits.slice(0, p.match_count);
  }

  // ---------- entity & OKR enrichment ----------

  // Collect all unique entity_refs across hits.
  const allEntityRefs = Array.from(
    new Set(hits.flatMap((h) => h.entity_refs ?? []))
  );

  let entityContext: EntityContext[] = [];
  let okrContext: OkrContext[] = [];

  if (allEntityRefs.length > 0) {
    // Query capabilities table.
    const { data: caps } = await sb
      .from("capabilities")
      .select("id, name, status")
      .in("id", allEntityRefs);

    if (caps && caps.length > 0) {
      entityContext = caps.map((c: { id: string; name: string; status: string | null }) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      }));

      const capIds = caps.map((c: { id: string }) => c.id);

      // Query okr_measurements where required_capabilities overlaps with capIds.
      const { data: measurements } = await sb
        .from("okr_measurements")
        .select("id, okr_node_id, required_capabilities, metric_name")
        .filter("required_capabilities", "ov", `{${capIds.join(",")}}`);

      if (measurements && measurements.length > 0) {
        const nodeIds = Array.from(
          new Set(
            measurements
              .map((m: { okr_node_id: string | null }) => m.okr_node_id)
              .filter((id): id is string => id !== null)
          )
        );

        if (nodeIds.length > 0) {
          const { data: nodes } = await sb
            .from("okr_nodes")
            .select("id, title, type, status, current_value, target_value")
            .in("id", nodeIds)
            .eq("status", "active");

          if (nodes && nodes.length > 0) {
            okrContext = nodes.map((n: {
              id: string;
              title: string;
              type: string | null;
              status: string | null;
              current_value: number | null;
              target_value: number | null;
            }) => ({
              id: n.id,
              title: n.title,
              type: n.type,
              status: n.status,
              current_value: n.current_value,
              target_value: n.target_value,
            }));
          }
        }
      }
    }
  }

  // ---------- map to response type ----------

  const mapped: IngestSearchHit[] = hits.map((h) => ({
    file_id: h.file_id,
    filename: h.filename,
    chunk_id: h.chunk_id,
    chunk_index: h.chunk_index,
    chunk_type: h.chunk_type,
    section_id: h.section_id,
    content: h.content,
    similarity: h.similarity,
    domain_id: h.domain_id,
    entity_refs: h.entity_refs ?? [],
    metadata: h.metadata,
  }));

  return json<IngestSearchResponse & { entity_context: EntityContext[]; okr_context: OkrContext[] }>({
    hits: mapped,
    query_tokens: qTokens,
    embed_model: EMBED_MODEL,
    entity_context: entityContext,
    okr_context: okrContext,
  });
}));
