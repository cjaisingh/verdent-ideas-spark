
# W9.0 — Client file ingestion via markitdown

## Why

Engagements receive client files (contracts, reports, spreadsheets, drawings, BIM, emails) feeding multiple domains. Today every file is re-tokenised by the LLM on each query — expensive and slow. Convert once at ingest into markdown + chunks + embeddings, store under `(engagement_id, domain_id)`, and let RAG read cheap structured text instead of raw binaries.

This is the substrate piece for W9 (engagements). It does NOT route, decide, or summarise — it ingests, parses, stores, emits events.

## Scope decisions (locked from chat)

- **Surfaces fed:** RAG corpus, Operator Inbox attachments, notebook/discussion-action attachments, engagement intake.
- **CAD/FM (DWG, RVT, IFC, NWD, etc.):** v1 stores file + indexes metadata only (filename, MIME, size, embedded thumbnail/preview if present, declared discipline). No geometry parsing. Adapter slot reserved for W9.2.
- **Execution:** hybrid.
  - **Sidecar** (containerised markitdown, called from `awip-api`) — interactive single-file drops, seconds-class latency.
  - **GHA worker** — nightly bulk re-index + back-fill + heavy/large files.
- **Ownership:** every file row carries `engagement_id` + `domain_id`. Re-engagement inherits via `engagement.continuation_of`.

## What gets built

### 1. Database (one migration)

New tables, all operator-only RLS, all with `service_role` GRANT for the sidecar/GHA worker:

- `ingested_files` — `engagement_id`, `domain_id`, `storage_path`, `mime`, `size_bytes`, `sha256` (dedupe key), `source` (`upload|inbox|notebook|gha-bulk`), `status` (`pending|parsing|parsed|metadata_only|failed`), `parser` (`markitdown|metadata_only|adapter:<name>`), `parser_version`, `failure_reason`, `uploaded_by`, `cad_fm` boolean.
- `ingested_file_chunks` — `file_id`, `chunk_index`, `content` (markdown), `tokens`, `embedding vector(3072)`, `metadata jsonb` (page/section/sheet). HNSW index on `embedding` with `vector_cosine_ops`.
- `ingested_file_events` — append-only event stream (`uploaded`, `parse_started`, `parsed`, `chunked`, `embedded`, `failed`, `superseded`).
- Unique index `(engagement_id, sha256)` for dedupe; new upload of same bytes → returns existing `file_id`.

Helper function `match_ingested_chunks(query_embedding, engagement_id, domain_ids[], match_count)` returning similarity-ranked chunks scoped to the caller's engagement/domain set.

### 2. Storage

Private Supabase Storage bucket `ingested-files`. Path: `<engagement_id>/<sha256>.<ext>`. Operator-only RLS via `has_role()`.

### 3. Edge functions (Deno, wrapped with `withLogger`, typed contracts in `_shared/contracts/`)

- `ingest-file` — accepts upload (signed URL or multipart), computes sha256, dedupes, writes `ingested_files` row, decides route:
  - CAD/FM extension → `metadata_only` (extract magic-bytes preview/thumbnail if present, no parse).
  - markitdown-supported MIME → enqueue sidecar job.
  - Oversize / batch flag → mark `pending`, leave for GHA worker.
- `ingest-callback` — sidecar/GHA POST markdown + chunks back. HMAC-signed body (reuse `APPROVAL_CALLBACK_SECRET` pattern). Writes chunks, calls embeddings via Lovable AI Gateway (`google/gemini-embedding-001`, 3072 dims), upserts vectors, emits `embedded` event.
- `ingest-search` — query endpoint. Embeds query once, calls `match_ingested_chunks`, returns chunks + file refs.
- `ingest-stale-sentinel` — pulled into existing `sentinel-tick`: flags files stuck in `parsing` >15min, failed >3× attempts.

All idempotent on `Idempotency-Key` = `sha256` for ingest, `(file_id, chunk_index)` for chunks.

### 4. Sidecar (separate repo / Cloud Run, not in this project)

Out of repo. The plan adds a `docs/runbooks/ingest-sidecar.md` spec: Python container running `markitdown`, polls `ingest_jobs` view or accepts signed-URL push, posts back to `ingest-callback`. Spec only — building/hosting is a follow-up discussion_action.

### 5. GHA worker

Workflow `.github/workflows/ingest-bulk.yml` — nightly 02:30 UTC. Reads pending `ingested_files` with `source='gha-bulk'` or `attempts<3 AND status='failed'`, runs markitdown locally, posts results via `AWIP_SERVICE_TOKEN`. Concurrency-1, 50-file cap per run.

### 6. UI

- `/engagements/<id>/files` — upload zone, file list with status pill, per-file domain selector, supersede/delete, retry-failed.
- `/admin/ingest-health` — queue depth, parser breakdown, failure reasons, last sidecar heartbeat. Linked from `/admin/edge-health`.

### 7. Observability

- Sentinel checks: `ingest_files_stuck_parsing`, `ingest_failures_burst`, `ingest_sidecar_silent`, `ingest_embeddings_rate_limited`.
- Add 4 entries to `observability_registry`.
- Credits ledger entry per embedding batch (tokens × rate proxy).

### 8. Docs + memory

- `docs/features/ingestion.md` — surfaces, pipeline diagram, parser routing table, CAD/FM caveat.
- `docs/runbooks/ingest-sidecar.md` — sidecar API contract + deploy notes.
- `mem://features/file-ingestion` index entry.
- CHANGELOG.

## Out of scope (logged as discussion_actions)

- Building/hosting the actual sidecar container (separate infra discussion).
- CAD/IFC/BIM geometry adapters (W9.2).
- Per-user OAuth for client cloud drives (Drive/SharePoint/Dropbox pull).
- Reranking (BM25+vector hybrid) — defer until corpus >10k chunks.
- Multilingual handling beyond what markitdown gives for free.

## Technical details

```text
upload ─► ingest-file ─► storage + ingested_files(pending)
                       │
            ┌──────────┼──────────┬───────────────┐
            ▼          ▼          ▼               ▼
       metadata_only  sidecar   gha-bulk      duplicate
       (CAD/FM)       (interactive) (nightly)  (return existing)
                          │          │
                          └────►ingest-callback (HMAC-signed)
                                     │
                                     ▼
                        chunks + embeddings(3072d)
                                     │
                                     ▼
                        match_ingested_chunks() ─► RAG, /companion, agents
```

Embedding model: `google/gemini-embedding-001` (3072 dims), called from `ingest-callback` only (server-side). Re-embed on model bump is gated by `parser_version` mismatch — handled by GHA worker.

Idempotency: `sha256(bytes)` is the dedupe key. Same bytes on the same engagement returns existing row, never re-parses. Same bytes on a different engagement parses again (engagement isolation > storage savings).

Auth on `ingest-callback`: HMAC over body using `APPROVAL_CALLBACK_SECRET`; same allowlist gate (`is_principal_allowed`) as other write callbacks.

Night-window model policy applies automatically (callback writes happening 22:00–06:00 UTC use the cheap embedding tier already — no change needed).

## Definition of done

- Migration applied; `bun run rls:verify` green.
- 6 edge functions wrapped with `withLogger`, typed contracts in place.
- `ingest-file` end-to-end test: upload PDF → row appears → mock callback posts chunks → `match_ingested_chunks` returns results.
- CAD/FM file (.dwg) ends in `metadata_only` without errors.
- Dedupe verified (same file twice → one row).
- `/engagements/.../files` and `/admin/ingest-health` rendering.
- 4 sentinel checks live; registry entries added.
- Docs + CHANGELOG + memory updated.
- Sidecar + CAD adapters logged as follow-up discussion_actions (not built).
