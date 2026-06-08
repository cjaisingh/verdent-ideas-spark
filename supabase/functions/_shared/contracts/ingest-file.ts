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
    }),
  ).max(2000),
  status: z.enum(["parsed", "metadata_only", "failed"]),
  failure_reason: z.string().max(2000).nullable().optional(),
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
};

export type IngestSearchResponse = {
  hits: IngestSearchHit[];
  query_tokens: number;
  embed_model: string;
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
} as const;
