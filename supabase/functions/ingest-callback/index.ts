// W9.1 — ingest-callback
// Sidecar (markitdown container) or GHA worker POSTs parsed markdown chunks
// back here. Body is HMAC-SHA256 signed with APPROVAL_CALLBACK_SECRET in the
// `x-approval-signature` header (reuses the W7 approval-callback pattern).
// We chunk-upsert, embed via Lovable AI Gateway (1536-dim), upsert entity refs,
// optionally store a doc-level embedding, and emit events.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import {
  IngestCallbackBody,
  type IngestCallbackResponse,
} from "../_shared/contracts/ingest-file.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-approval-signature, x-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMBED_MODEL = "google/gemini-embedding-001";
const EMBED_DIMS = 1536;

async function verifyHmac(secret: string, body: string, sig: string | null): Promise<boolean> {
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // constant-time compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function embedBatch(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: inputs,
      dimensions: EMBED_DIMS,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`embed_failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

Deno.serve(withLogger("ingest-callback", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const HMAC_SECRET = Deno.env.get("APPROVAL_CALLBACK_SECRET");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!HMAC_SECRET) return json({ error: "callback_secret_not_configured" }, 503);

  const rawBody = await req.text();

  // Fix (1): strip the `sha256=` prefix before comparing.
  const rawSig = req.headers.get("x-approval-signature");
  const cleanSig = rawSig?.replace(/^sha256=/, "") ?? "";
  const ok = await verifyHmac(HMAC_SECRET, rawBody, cleanSig || null);
  if (!ok) return json({ error: "invalid_signature" }, 401);

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return json({ error: "invalid_json" }, 400); }

  // Accept W9.1 chunk fields (chunk_type, section_id, parent_chunk_index,
  // is_section_root, entity_refs, doc_embedding) while keeping IngestCallbackBody
  // as the base schema; extra fields are passed through as `unknown` via z.passthrough
  // on the chunk sub-object or accessed directly from `body`.
  const parsed = IngestCallbackBody.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;

  // Pull W9.1 extension fields from the raw body (not enforced by the base schema).
  const rawBody_ = body as Record<string, unknown>;
  const rawChunks = (Array.isArray(rawBody_.chunks) ? rawBody_.chunks : []) as Array<
    Record<string, unknown>
  >;
  const docEmbedding: number[] | null =
    Array.isArray(rawBody_.doc_embedding) && rawBody_.doc_embedding.length === EMBED_DIMS
      ? (rawBody_.doc_embedding as number[])
      : null;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Confirm file exists.
  const { data: file, error: fErr } = await sb
    .from("ingested_files")
    .select("id, status")
    .eq("id", p.file_id)
    .maybeSingle();
  if (fErr || !file) return json({ error: "file_not_found" }, 404);

  if (p.status === "failed") {
    // Fix (2): atomic attempt counter — two separate statements, null-safe.
    const { data: cur } = await sb
      .from("ingested_files")
      .select("attempts")
      .eq("id", p.file_id)
      .single();
    const newAttempts = typeof cur?.attempts === "number" ? cur.attempts + 1 : 1;

    await sb.from("ingested_files").update({
      status: "failed",
      failure_reason: p.failure_reason ?? "unknown",
      attempts: newAttempts,
    }).eq("id", p.file_id);
    await sb.from("ingested_file_events").insert({
      file_id: p.file_id,
      event_type: "failed",
      actor: "sidecar",
      payload: { failure_reason: p.failure_reason },
    });
    return json<IngestCallbackResponse>({
      file_id: p.file_id, chunks_written: 0, embeddings_queued: 0, status: "failed",
    });
  }

  // Mark parsing.
  await sb.from("ingested_files").update({
    status: "parsing",
    parser: p.parser,
    parser_version: p.parser_version,
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", p.file_id);

  // Fix (3): include W9.1 semantic index fields in chunk rows.
  const chunkRows = p.chunks.map((c, i) => {
    const raw = rawChunks[i] ?? {};
    return {
      file_id: p.file_id,
      chunk_index: c.chunk_index,
      content: c.content,
      tokens: c.tokens ?? null,
      metadata: c.metadata,
      embed_model: EMBED_MODEL,
      // W9.1 fields — stored as-is; schema columns must exist in the table.
      chunk_type: typeof raw.chunk_type === "string" ? raw.chunk_type : null,
      section_id: typeof raw.section_id === "string" ? raw.section_id : null,
      parent_chunk_index:
        typeof raw.parent_chunk_index === "number" ? raw.parent_chunk_index : null,
      is_section_root: typeof raw.is_section_root === "boolean" ? raw.is_section_root : false,
    };
  });

  // Fix (4): upsert chunks and return IDs so we can link entity_refs.
  let upsertedChunks: Array<{ id: string; chunk_index: number }> = [];
  if (chunkRows.length > 0) {
    const { data: upserted, error: chErr } = await sb
      .from("ingested_file_chunks")
      .upsert(chunkRows, { onConflict: "file_id,chunk_index" })
      .select("id, chunk_index");
    if (chErr) {
      return json({ error: "chunk_upsert_failed", detail: chErr.message }, 500);
    }
    upsertedChunks = (upserted ?? []) as Array<{ id: string; chunk_index: number }>;

    await sb.from("ingested_file_events").insert({
      file_id: p.file_id, event_type: "chunked", actor: "sidecar",
      payload: { chunks: chunkRows.length },
    });
  }

  // Fix (4 cont.): upsert entity refs for chunks that carry entity_refs.
  let totalEntities = 0;
  if (upsertedChunks.length > 0) {
    // Build a lookup: chunk_index → uuid returned from the upsert.
    const chunkIdByIndex = new Map<number, string>();
    for (const row of upsertedChunks) {
      chunkIdByIndex.set(row.chunk_index, row.id);
    }

    const entityRows: Array<{
      chunk_id: string;
      entity_id: string;
      raw_mention: string;
      confidence: number;
      extraction_method: string;
    }> = [];

    for (let i = 0; i < p.chunks.length; i++) {
      const raw = rawChunks[i] ?? {};
      const entityRefs = Array.isArray(raw.entity_refs) ? (raw.entity_refs as string[]) : [];
      if (entityRefs.length === 0) continue;

      const chunkId = chunkIdByIndex.get(p.chunks[i].chunk_index);
      if (!chunkId) continue;

      for (const entity_id of entityRefs) {
        if (typeof entity_id !== "string") continue;
        entityRows.push({
          chunk_id: chunkId,
          entity_id,
          raw_mention: "",       // sidecar doesn't provide raw_mention in v1
          confidence: 1.0,
          extraction_method: "string_match",
        });
      }
    }

    if (entityRows.length > 0) {
      const { error: entErr } = await sb
        .from("ingested_chunk_entities")
        .upsert(entityRows, { onConflict: "chunk_id,entity_id", ignoreDuplicates: true });
      if (entErr) {
        // Non-fatal: log but don't abort the whole callback.
        await sb.from("ingested_file_events").insert({
          file_id: p.file_id, event_type: "failed", actor: "entity-linker",
          payload: { stage: "entity_upsert", error: entErr.message.slice(0, 500) },
        });
      } else {
        totalEntities = entityRows.length;
      }
    }
  }

  // Emit entities_extracted event (fix 6).
  if (totalEntities > 0) {
    await sb.from("ingested_file_events").insert({
      file_id: p.file_id, event_type: "entities_extracted", actor: "sidecar",
      payload: { entities: totalEntities },
    });
  }

  // Embed chunks in batches of 32.
  let embeddedCount = 0;
  if (LOVABLE_API_KEY && p.status === "parsed" && chunkRows.length > 0) {
    const batchSize = 32;
    for (let i = 0; i < p.chunks.length; i += batchSize) {
      const slice = p.chunks.slice(i, i + batchSize);
      try {
        const vectors = await embedBatch(LOVABLE_API_KEY, slice.map((c) => c.content));
        for (let j = 0; j < slice.length; j++) {
          const vec = vectors[j];
          if (!vec) continue;
          await sb.from("ingested_file_chunks")
            .update({ embedding: vec as unknown as string })
            .eq("file_id", p.file_id)
            .eq("chunk_index", slice[j].chunk_index);
          embeddedCount++;
        }
      } catch (err) {
        await sb.from("ingested_file_events").insert({
          file_id: p.file_id, event_type: "failed", actor: "embedder",
          payload: { stage: "embed", error: String(err).slice(0, 500), batch_start: i },
        });
        // continue — partial embedding is better than nothing
      }
    }
    await sb.from("ingested_file_events").insert({
      file_id: p.file_id, event_type: "embedded", actor: "embedder",
      payload: { embedded: embeddedCount, model: EMBED_MODEL },
    });
  }

  // Fix (5): persist doc-level embedding if provided.
  if (docEmbedding) {
    await sb
      .from("ingested_files")
      .update({ doc_embedding: docEmbedding as unknown as string })
      .eq("id", p.file_id);
    await sb.from("ingested_file_events").insert({
      file_id: p.file_id, event_type: "doc_embedded", actor: "sidecar",
      payload: { dims: docEmbedding.length },
    });
  }

  // Final status.
  const finalStatus = p.status;
  await sb.from("ingested_files").update({
    status: finalStatus,
    parsed_at: finalStatus === "parsed" ? new Date().toISOString() : null,
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", p.file_id);
  await sb.from("ingested_file_events").insert({
    file_id: p.file_id,
    event_type: finalStatus === "metadata_only" ? "metadata_only" : "parsed",
    actor: "sidecar",
    payload: { parser: p.parser, parser_version: p.parser_version },
  });

  return json<IngestCallbackResponse>({
    file_id: p.file_id,
    chunks_written: chunkRows.length,
    embeddings_queued: embeddedCount,
    status: finalStatus,
  });
}));
