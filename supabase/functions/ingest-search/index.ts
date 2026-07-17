// W9.1 — ingest-search
// Operator queries ingested chunks scoped to one engagement. Hybrid retrieval
// (dense + lexical + RRF) via hybrid_match_ingested_chunks, with optional
// semantic filters (entity_ids, chunk_types) pushed into the RPC so ranking
// happens over the filtered corpus. Optional structured leg over
// canonical_facts. Resolves entity_refs into EntityContext + OkrContext.
// Hierarchical mode caps chunks-per-file so one document can't dominate.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import {
  IngestSearchBody,
  type IngestSearchResponse,
  type IngestSearchHit,
  type IngestSearchFactHit,
  type EntityContext,
  type OkrContext,
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
const EMBED_TIMEOUT_MS = 20_000;

type RawHybridHit = {
  chunk_id: string | null;
  file_id: string;
  filename: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  domain_id: string | null;
  chunk_type: string | null;
  section_id: string | null;
  entity_refs: string[] | null;
  dense_similarity: number | null;
  lexical_score: number | null;
  dense_rank: number | null;
  lexical_rank: number | null;
  rrf_score: number;
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

  // Embed query (skipped in lexical-only mode), bounded by EMBED_TIMEOUT_MS.
  let vec: number[] | null = null;
  let qTokens = 0;
  if (p.mode !== "lexical") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    let eRes: Response;
    try {
      eRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: p.query, dimensions: EMBED_DIMS }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return json({ error: "embed_timeout" }, 502);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!eRes.ok) {
      const text = await eRes.text();
      return json({ error: "embed_failed", status: eRes.status, detail: text.slice(0, 300) }, 502);
    }
    const eData = await eRes.json();
    vec = eData?.data?.[0]?.embedding ?? null;
    qTokens = eData?.usage?.prompt_tokens ?? 0;
    if (!vec) return json({ error: "embed_empty" }, 502);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Dense-only mode: blank query_text → lexical CTE no-ops.
  // Lexical-only mode: null embedding → dense CTE no-ops (RPC handles this).
  const callEmbedding = p.mode === "lexical" ? null : (vec as number[]);
  const callQueryText = p.mode === "dense" ? "" : p.query;

  // Hierarchical mode over-fetches so we can cap chunks-per-file afterwards.
  const fetchCount = p.hierarchical ? p.match_count * 2 : p.match_count;

  const { data: rawHits, error: mErr } = await sb.rpc("hybrid_match_ingested_chunks", {
    query_embedding: callEmbedding as unknown as string | null,
    query_text: callQueryText,
    p_engagement_id: p.engagement_id,
    p_domain_ids: p.domain_ids ?? null,
    match_count: fetchCount,
    rrf_k: p.rrf_k,
    candidate_pool: p.candidate_pool,
    p_entity_ids: p.entity_ids ?? null,
    p_chunk_types: p.chunk_types ?? null,
  });

  if (mErr) return json({ error: "search_failed", detail: mErr.message }, 500);

  let hits: RawHybridHit[] = rawHits ?? [];

  // Hierarchical de-duplication: max 3 chunks per file, preserving RRF order.
  if (p.hierarchical) {
    const countByFile = new Map<string, number>();
    hits = hits.filter((h) => {
      const count = countByFile.get(h.file_id) ?? 0;
      if (count >= 3) return false;
      countByFile.set(h.file_id, count + 1);
      return true;
    });
    hits = hits.slice(0, p.match_count);
  }

  const mapped: IngestSearchHit[] = hits.map((h) => ({
    file_id: h.file_id,
    filename: h.filename,
    chunk_index: h.chunk_index,
    content: h.content,
    similarity: h.dense_similarity ?? 0,
    lexical_score: h.lexical_score ?? 0,
    dense_rank: h.dense_rank,
    lexical_rank: h.lexical_rank,
    rrf_score: h.rrf_score,
    domain_id: h.domain_id,
    metadata: h.metadata,
    chunk_id: h.chunk_id ?? `${h.file_id}:${h.chunk_index}`,
    chunk_type: h.chunk_type ?? "general",
    section_id: h.section_id,
    entity_refs: h.entity_refs ?? [],
  }));

  // ---------- optional structured leg: canonical_facts ----------
  let factHits: IngestSearchFactHit[] | undefined;
  if (p.include_facts) {
    const { data: fRows, error: fErr } = await sb.rpc("search_canonical_facts", {
      q: p.query,
      engagement: p.engagement_id,
      match_count: p.fact_match_count,
    });
    if (fErr) return json({ error: "fact_search_failed", detail: fErr.message }, 500);
    factHits = (fRows ?? []).map((r: {
      fact_id: string; tenant_node_id: string | null; fact_type: string;
      value: unknown; effective_at: string; file_id: string; filename: string;
      lexical_score: number;
    }) => ({
      fact_id: r.fact_id,
      tenant_node_id: r.tenant_node_id,
      fact_type: r.fact_type,
      value: r.value,
      effective_at: r.effective_at,
      file_id: r.file_id,
      filename: r.filename,
      lexical_score: r.lexical_score ?? 0,
    }));
  }

  // ---------- entity & OKR enrichment ----------
  const allEntityRefs = Array.from(new Set(hits.flatMap((h) => h.entity_refs ?? [])));

  let entityContext: EntityContext[] = [];
  let okrContext: OkrContext[] = [];
  const enrichmentErrors: string[] = [];

  if (allEntityRefs.length > 0) {
    const { data: caps, error: capErr } = await sb
      .from("capabilities")
      .select("id, name, status")
      .in("id", allEntityRefs);
    if (capErr) enrichmentErrors.push(`capabilities: ${capErr.message}`);

    const capRows = caps ?? [];
    const capIdSet = new Set(capRows.map((c: { id: string }) => c.id));

    entityContext = [
      ...capRows.map((c: { id: string; name: string }) => ({
        entity_id: c.id, name: c.name, kind: "capability",
      })),
      ...allEntityRefs
        .filter((ref) => !capIdSet.has(ref))
        .map((ref) => ({ entity_id: ref, name: ref, kind: "unknown" })),
    ];

    if (capIdSet.size > 0) {
      const capIds = Array.from(capIdSet);
      const { data: measurements, error: mmErr } = await sb
        .from("okr_measurements")
        .select("id, okr_node_id, required_capabilities, metric_name")
        .filter("required_capabilities", "ov", `{${capIds.join(",")}}`);
      if (mmErr) enrichmentErrors.push(`okr_measurements: ${mmErr.message}`);

      const mRows = (measurements ?? []) as Array<{
        okr_node_id: string | null; required_capabilities: string[] | null;
      }>;

      const capsByNode = new Map<string, Set<string>>();
      for (const m of mRows) {
        if (!m.okr_node_id) continue;
        const linked = (m.required_capabilities ?? []).filter((id) => capIdSet.has(id));
        if (linked.length === 0) continue;
        const set = capsByNode.get(m.okr_node_id) ?? new Set<string>();
        for (const id of linked) set.add(id);
        capsByNode.set(m.okr_node_id, set);
      }

      const nodeIds = Array.from(capsByNode.keys());
      if (nodeIds.length > 0) {
        const { data: nodes, error: nodeErr } = await sb
          .from("okr_nodes")
          .select("id, title, type, status, current_value, target_value")
          .in("id", nodeIds)
          .eq("status", "active");
        if (nodeErr) enrichmentErrors.push(`okr_nodes: ${nodeErr.message}`);

        okrContext = (nodes ?? []).map((n: {
          id: string; title: string; type: string | null; status: string | null;
          current_value: number | null; target_value: number | null;
        }) => ({
          node_id: n.id,
          title: n.title,
          type: n.type ?? "unknown",
          status: n.status ?? "unknown",
          current_value: n.current_value,
          target_value: n.target_value,
          linked_capability_ids: Array.from(capsByNode.get(n.id) ?? []),
        }));
      }
    }
  }

  return json({
    hits: mapped,
    fact_hits: factHits,
    query_tokens: qTokens,
    embed_model: EMBED_MODEL,
    mode: p.mode,
    rrf_k: p.rrf_k,
    entity_context: entityContext,
    okr_context: okrContext,
    ...(enrichmentErrors.length > 0 ? { enrichment_errors: enrichmentErrors } : {}),
  } satisfies IngestSearchResponse & { enrichment_errors?: string[] });
}));
