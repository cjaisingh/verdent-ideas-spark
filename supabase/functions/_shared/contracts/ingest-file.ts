// Typed contract for the W9.0 client file ingestion substrate.
//
// One contract surface, three endpoints:
//   - ingest-file        operator uploads a file (after putting bytes in storage)
//   - ingest-callback    sidecar/GHA worker posts parsed markdown + chunks back
//   - ingest-search      operator queries chunks scoped to an engagement
//
// All idempotent on `sha256` (file) and `(file_id, chunk_index)` (chunks).
// CAD/FM file types are stored + indexed metadata-only in v1; no parse.
//
// Semantic index fields (chunk_type, section_id, parent_chunk_index,
// is_section_root, entity_refs, doc_embedding) were added in W9.1 to enable
// hierarchical retrieval and entity-scoped search.
//
// See docs/features/ingestion.md and docs/agents/contract-checklist.md.

import { z } from "https://esm.sh/zod@3.23.8";

// ---------- shared ----------

export const SOURCES = [
  "upload",
  "inbox",
  "notebook",
  "gha-bulk",
  "engagement-intake",
] as const;
export type IngestSource = (typeof SOURCES)[number];

export const STATUSES = [
  "pending",
  "parsing",
  "parsed",
  "metadata_only",
  "failed",
  "superseded",
] as const;
export type IngestStatus = (typeof STATUSES)[number];

// File extensions handled as metadata-only in v1 (CAD/FM).
// Anything matching this set bypasses markitdown.
export const CAD_FM_EXTENSIONS = new Set([
  "dwg", "dxf", "dgn",                   // 2D CAD
  "rvt", "rfa", "rte",                   // Revit / BIM
  "ifc", "ifczip",                       // openBIM
  "nwc", "nwd", "nwf",                   // Navisworks
  "skp",                                  // SketchUp
  "step", "stp", "iges", "igs",          // mechanical CAD interchange
  "3ds", "obj", "fbx", "gltf", "glb",   // mesh/3D
  "pln", "gsm",                          // Archicad
  "cof",                                  // ConceptDraw FM
]);

export function isCadFmExtension(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return CAD_FM_EXTENSIONS.has(ext);
}

// markitdown-supported MIMEs we want the sidecar/GHA to handle.
// Everything else falls back to metadata_only with a warning.
export const MARKITDOWN_MIME_PREFIXES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-",
  "application/msword",
  "application/vnd.ms-outlook",
  "message/rfc822",
  "text/",
  "image/",                              // OCR path
  "audio/",                              // transcription path
];

export function isMarkitdownSupported(mime: string): boolean {
  const m = mime.toLowerCase();
  return MARKITDOWN_MIME_PREFIXES.some((p) => m.startsWith(p));
}

// ---------- semantic index shared enum ----------

// Chunk classification labels understood by the semantic index.
// Used in both IngestCallbackBody (write) and IngestSearchBody (filter).
export const CHUNK_TYPES = [
  "maintenance_record",
  "asset_spec",
  "compliance_clause",
  "inspection_note",
  "procedure",
  "general",
] as const;
export type ChunkType = (typeof CHUNK_TYPES)[number];

// ---------- ingest-file ----------

export const IngestFileBody = z.object({
  engagement_id: z.string().uuid(),
  domain_id: z.string().uuid().nullable().optional(),
  storage_path: z.string().min(1).max(512),
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(255),
  size_bytes: z.number().int().min(0).max(2_147_483_647),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  source: z.enum(SOURCES).default("upload"),
  declared_discipline: z.string().max(64).nullable().optional(),
  force_route: z.enum(["sidecar", "gha-bulk", "metadata_only"]).nullable().optional(),
});
export type IngestFileBody = z.infer<typeof IngestFileBody>;

export type IngestFileResponse = {
  file_id: string;
  status: IngestStatus;
  parser: string | null;
  deduped: boolean;
  route: "sidecar" | "gha-bulk" | "metadata_only" | "duplicate";
};

// ---------- ingest-callback ----------

export const IngestCallbackBody = z.object({
  file_id: z.string().uuid(),
  parser: z.string().min(1).max(64),               // "markitdown" | "metadata_only" | "adapter:<name>"
  parser_version: z.string().min(1).max(32),
  chunks: z.array(
    z.object({
      chunk_index: z.number().int().min(0),
      content: z.string().min(1).max(20000),
      tokens: z.number().int().min(0).optional(),
      metadata: z.record(z.unknown()).default({}),

      // --- semantic index fields (W9.1) ---
      // Classification label for this chunk; drives filtered retrieval.
      chunk_type: z.enum(CHUNK_TYPES).default("general"),
      // Section heading or logical section identifier within the document.
      // Used to group sibling chunks under the same heading.
      section_id: z.string().max(255).nullable().optional(),
      // chunk_index of the parent chunk in a hierarchical doc structure.
      // Integer index (not a DB UUID) — the sidecar does not know DB UUIDs.
      parent_chunk_index: z.number().int().min(0).nullable().optional(),
      // True when this chunk is the root / summary node for a section.
      // The coarse retrieval pass preferentially fetches section roots.
      is_section_root: z.boolean().default(false),
      // UUIDs of domain entities (assets, spaces, systems, …) that the
      // sidecar resolved from the chunk text via NER / lookup.
      entity_refs: z.array(z.string().uuid()).max(50).default([]),
    }),
  ).max(2000),
  status: z.enum(["parsed", "metadata_only", "failed"]),
  failure_reason: z.string().max(2000).nullable().optional(),

  // --- doc-level embedding (W9.1) ---
  // 1536-dimensional vector representing the whole document.
  // Used for coarse (doc-level) retrieval before chunk re-ranking.
  // Omit when the sidecar cannot produce a doc embedding (e.g. metadata_only).
  doc_embedding: z.array(z.number()).length(1536).nullable().optional(),
});
export type IngestCallbackBody = z.infer<typeof IngestCallbackBody>;

export type IngestCallbackResponse = {
  file_id: string;
  chunks_written: number;
  embeddings_queued: number;
  status: IngestStatus;
};

// ---------- ingest-search ----------

export const IngestSearchBody = z.object({
  query: z.string().min(1).max(2000),
  engagement_id: z.string().uuid(),
  domain_ids: z.array(z.string().uuid()).max(16).nullable().optional(),
  match_count: z.number().int().min(1).max(50).default(8),

  // --- semantic index filters (W9.1) ---
  // Restrict retrieval to chunks that reference any of these entity UUIDs.
  entity_ids: z.array(z.string().uuid()).max(32).nullable().optional(),
  // Restrict retrieval to specific chunk classification labels.
  chunk_types: z.array(z.enum(CHUNK_TYPES)).max(6).nullable().optional(),
  // When true (default), perform a coarse doc-level retrieval pass first,
  // then re-rank within the top-K documents using chunk embeddings.
  hierarchical: z.boolean().default(true),
});
export type IngestSearchBody = z.infer<typeof IngestSearchBody>;

export type IngestSearchHit = {
  file_id: string;
  filename: string;
  chunk_index: number;
  content: string;
  similarity: number;
  domain_id: string | null;
  metadata: Record<string, unknown>;

  // --- semantic index fields (W9.1) ---
  chunk_id: string;           // DB UUID of the chunk row
  chunk_type: string;         // one of CHUNK_TYPES
  section_id: string | null;  // section heading / identifier, if set
  entity_refs: string[];      // entity UUIDs resolved for this chunk
};

// Entity resolved from entity_refs during search result enrichment.
export type EntityContext = {
  entity_id: string;
  name: string;
  kind: string; // 'capability' | 'asset' | 'space' | 'system' | 'unknown'
};

// OKR / goal node linked to entities that appeared in the search results.
export type OkrContext = {
  node_id: string;
  title: string;
  type: string;
  status: string;
  current_value: number | null;
  target_value: number | null;
  linked_capability_ids: string[];
};

export type IngestSearchResponse = {
  hits: IngestSearchHit[];
  query_tokens: number;
  embed_model: string;

  // --- semantic index enrichment (W9.1) ---
  // Deduplicated entity records for every entity_ref that appeared in hits.
  entity_context: EntityContext[];
  // OKR nodes linked to those entities, for contextual goal awareness.
  okr_context: OkrContext[];
};

// ---------- contract metadata ----------

export const INGEST_CONTRACT = {
  canonicalQuestion:
    "Convert this client file to markdown chunks scoped to (engagement_id, domain_id) so RAG can read it without re-tokenising the binary.",
  mandatoryEvidence: ["engagement_id", "storage_path", "sha256", "mime"] as const,
  optionalEvidence: ["domain_id", "declared_discipline", "force_route"] as const,
  idempotencyKey: "(engagement_id, sha256)" as const,
  callbackAuth: "HMAC over body using APPROVAL_CALLBACK_SECRET; reuse APPROVAL_CALLBACK_ALLOWED_HOSTS" as const,
  cadFmPolicy:
    "v1: metadata_only. No geometry parsing. Adapter slot reserved for W9.2." as const,
  embedModel: "google/gemini-embedding-001 (dimensions=1536)" as const,

  // W9.1 semantic index additions
  semanticIndex:
    "Two-pass hierarchical retrieval: (1) coarse doc-level ANN using doc_embedding; " +
    "(2) chunk-level re-ranking within shortlisted docs. Chunks are classified by " +
    "chunk_type and organised into section trees via section_id + parent_chunk_index. " +
    "Section root chunks (is_section_root=true) are preferentially fetched in the " +
    "coarse pass. Results are enriched with EntityContext and OkrContext for the " +
    "entity_refs that appear across returned hits." as const,
  entityExtraction:
    "entity_refs in each chunk must be populated by the sidecar via NER + entity " +
    "lookup against the engagement's domain entity registry before posting the callback. " +
    "Only confirmed UUID matches should be included; fuzzy candidates must be omitted." as const,
} as const;
