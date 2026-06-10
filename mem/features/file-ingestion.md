---
name: File ingestion (W9.0)
description: markitdown-backed client file ingestion; engagement+domain scoped; hybrid sidecar/GHA; CAD/FM metadata-only
type: feature
---

W9.0 substrate for client file ingestion.

## Tables
- `ingested_files` — dedupe by `(engagement_id, sha256)`; status pending/parsing/parsed/metadata_only/failed/superseded; `cad_fm` flag.
- `ingested_file_chunks` — markdown + vector(1536) with HNSW index.
- `ingested_file_events` — append-only lifecycle audit.

## Edge functions
- `ingest-file` — operator/service auth, dedupes, classifies route (sidecar / gha-bulk / metadata_only / duplicate).
- `ingest-callback` — HMAC-signed via `APPROVAL_CALLBACK_SECRET`; upserts chunks; embeds via `google/gemini-embedding-001` (dims=1536) in batches of 32.
- `ingest-search` — operator/service auth; embeds query then `match_ingested_chunks(engagement_id, domain_ids[])`.

## Routing
- CAD/FM ext (DWG/RVT/IFC/NWD/SKP/STEP/…) → metadata_only, no parse.
- MIME not in markitdown allow-list → metadata_only.
- `size > 25 MB` → `gha-bulk` (nightly 02:30 UTC, `.github/workflows/ingest-bulk.yml`).
- else → sidecar.

## Storage
- Private bucket `ingested-files`, operator-only RLS on storage.objects.
- Path convention: `<engagement_id>/<sha256>.<ext>`.

## UI
- `/admin/ingest-health` — status counts, recent files, stuck/failed banners.

## Sentinel (wired 2026-06-10)
- `ingest_files_stuck_parsing` — status=parsing + heartbeat >15min stale; medium, high ≥5.
- `ingest_files_failed_burst` — ≥3 failures/24h; medium, high ≥10.

## GHA worker
- `scripts/ingest-bulk-worker.py` — local markitdown, claims via PATCH on PostgREST, posts HMAC-signed callbacks. Requires `SUPABASE_SERVICE_ROLE_KEY` as a GHA secret.

## Out of scope (v1)
- Sidecar host + actual sidecar container (separate infra discussion).
- CAD/IFC/BIM geometry adapters → W9.2.
- Per-user OAuth for client cloud drives.
- BM25+vector reranker (defer until >10k chunks).

## Contract source
`supabase/functions/_shared/contracts/ingest-file.ts` (mandatory + optional evidence, idempotency key, embed model).

## Docs
- `docs/features/ingestion.md`
- `docs/runbooks/ingest-sidecar.md`
