// W9.0 — ingest-search
// Operator queries ingested chunks scoped to one engagement (+ optional
// domain filter). Embeds the query via Lovable AI Gateway and calls
// public.match_ingested_chunks.

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

  // Embed query (skipped in lexical-only mode).
  let vec: number[] | null = null;
  let qTokens = 0;
  if (p.mode !== "lexical") {
    const eRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: p.query, dimensions: EMBED_DIMS }),
    });
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

  // Dense-only mode: zero out query_text so the lexical CTE returns nothing.
  // Lexical-only mode: pass a zero vector so the dense CTE returns nothing
  // (embedding IS NULL filter excludes real chunks from matching a zero vec
  // via cosine; we still want to skip the dense leg cleanly, so we send a
  // zero-filled vector and trust the rrf_score ordering to surface lexical
  // hits exclusively because dense_rank will be > pool for non-matches).
  const zeroVec = new Array(EMBED_DIMS).fill(0);
  const callEmbedding =
    p.mode === "lexical" ? zeroVec : (vec as number[]);
  const callQueryText = p.mode === "dense" ? "" : p.query;

  const { data: hits, error: mErr } = await sb.rpc("hybrid_match_ingested_chunks", {
    query_embedding: callEmbedding as unknown as string,
    query_text: callQueryText,
    p_engagement_id: p.engagement_id,
    p_domain_ids: p.domain_ids ?? null,
    match_count: p.match_count,
    rrf_k: p.rrf_k,
    candidate_pool: p.candidate_pool,
  });

  if (mErr) return json({ error: "search_failed", detail: mErr.message }, 500);

  const mapped: IngestSearchHit[] = (hits ?? []).map((h: {
    file_id: string; filename: string; chunk_index: number; content: string;
    dense_similarity: number | null; lexical_score: number | null;
    dense_rank: number | null; lexical_rank: number | null; rrf_score: number;
    domain_id: string | null; metadata: Record<string, unknown>;
  }) => ({
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
  }));

  return json<IngestSearchResponse>({
    hits: mapped,
    query_tokens: qTokens,
    embed_model: EMBED_MODEL,
    mode: p.mode,
    rrf_k: p.rrf_k,
  });
}));
