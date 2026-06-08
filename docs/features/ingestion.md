# File ingestion (W9.0)

Substrate for converting client files into markdown chunks + embeddings, scoped to `(engagement_id, domain_id)`. Built so RAG and agents read pre-parsed text instead of re-tokenising binaries.

## Surfaces fed

- RAG corpus / `ingest-search`
- Operator Inbox attachments
- Notebook + discussion-action attachments
- Engagement intake (contracts, requirements)

## Pipeline

```
upload → ingest-file → storage + ingested_files(pending)
                    │
        ┌───────────┼───────────┬──────────────┐
        ▼           ▼           ▼              ▼
   metadata_only  sidecar    gha-bulk      duplicate
   (CAD/FM /    (interactive)  (nightly,    (same sha256
    unsupported)  ≤25MB)       >25MB)       on engagement)
                     │           │
                     └────► ingest-callback (HMAC-signed)
                                  │
                                  ▼
                    chunks + embeddings (1536d, google/gemini-embedding-001)
                                  │
                                  ▼
                    match_ingested_chunks() → ingest-search → consumers
```

## Tables

- `ingested_files` — one row per file. Dedupe key `(engagement_id, sha256)`.
- `ingested_file_chunks` — markdown chunks + vector(1536) embeddings. HNSW index.
- `ingested_file_events` — append-only lifecycle audit.

## Edge functions

| Function | Auth | Idempotency |
|---|---|---|
| `ingest-file` | operator JWT or service token | `(engagement_id, sha256)` |
| `ingest-callback` | HMAC over body via `APPROVAL_CALLBACK_SECRET` | `(file_id, chunk_index)` upsert |
| `ingest-search` | operator JWT or service token | n/a (read) |

## Routing table

| Condition | Route | Status |
|---|---|---|
| Same `(engagement_id, sha256)` exists | `duplicate` | returns existing row |
| CAD/FM extension (DWG, RVT, IFC, NWD, …) | `metadata_only` | `metadata_only` |
| MIME not in markitdown allow-list | `metadata_only` | `metadata_only` |
| size > 25 MB | `gha-bulk` | `pending` (nightly worker) |
| else | `sidecar` | `pending` (interactive) |

`force_route` in the request body overrides classification.

## CAD/FM caveat

v1 stores the file + indexes metadata only (filename, MIME, size, declared discipline). **No geometry parsing.** Adapter slot reserved for W9.2 — DWG via LibreCAD/ODA, IFC via IFC.js, RVT via Forge, etc. Tracked as a discussion_action.

## Sidecar

Out-of-repo Python service running `markitdown`. Contract in `docs/runbooks/ingest-sidecar.md`. Posts back to `ingest-callback` with an HMAC body signature.

## GHA worker

`.github/workflows/ingest-bulk.yml` — nightly 02:30 UTC. Picks up `source='gha-bulk'` + failed/retryable files, runs markitdown locally, posts via `AWIP_SERVICE_TOKEN`. Concurrency-1, 50-file cap per run.

## Secrets required

- `APPROVAL_CALLBACK_SECRET` — HMAC key for `ingest-callback`. Reused from W7 approval callback.
- `LOVABLE_API_KEY` — already present; used for embeddings.
- `AWIP_SERVICE_TOKEN` — already present; used by GHA worker.

## Out of scope (v1)

- Hosting the markitdown sidecar (separate infra decision)
- CAD/IFC/BIM geometry adapters (W9.2)
- Per-user OAuth for client cloud drives (Drive/SharePoint/Dropbox pull)
- BM25 + vector hybrid reranking (defer until corpus >10k chunks)
