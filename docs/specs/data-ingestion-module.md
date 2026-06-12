# Data Ingestion Module — Comprehensive Spec

Status: draft v1 (covers W9.0 shipped + W9.1–W9.3 planned)
Owners: capability-architect, event-engineer
Related: [`docs/features/ingestion.md`](../features/ingestion.md), [`mem/features/file-ingestion.md`](../../mem/features/file-ingestion.md), [`mem/features/ingest-pipeline-schema.md`](../../mem/features/ingest-pipeline-schema.md), [`docs/retrieval-contracts.md`](../retrieval-contracts.md), [`mem/preferences/retrieval-shapes.md`](../../mem/preferences/retrieval-shapes.md)

---

## 1. Purpose & scope

Convert any client artefact — uploaded files, inbox attachments, notebook drops, scheduled pulls, structured source feeds — into **typed, indexed, retrievable evidence** scoped to `(engagement_id, domain_id)`, so every downstream agent (RAG, validation, conflict triage, copilot) reads pre-parsed text/structure instead of re-tokenising binaries.

In scope:
- File capture, dedup, classification, parse routing.
- Multi-index fan-out: vector / lexical / structured / graph / time-series.
- Lifecycle audit + sentinel coverage.
- Retrieval contracts per consumer surface.

Out of scope (v1):
- Per-user OAuth pulls from Drive/SharePoint/Dropbox (W9.4).
- CAD/IFC/BIM geometry adapters (W9.2 — slot reserved, metadata only today).
- A cross-engagement global corpus (deliberate: every chunk is engagement-scoped).

---

## 2. Pipeline overview

```text
                    ┌──────────────────────────────────────────────┐
   sources ───►     │              ingest-file (edge fn)           │
 upload | inbox     │  authz → dedup → classify → row + event      │
 notebook | gha     └─────────────────┬────────────────────────────┘
 engagement-intake                    │
                                      ▼
                    ┌─────────────────────────────────────────────┐
                    │           route classifier                  │
                    │  duplicate | metadata_only | sidecar |      │
                    │  gha-bulk  | structured-adapter | graph     │
                    └──────┬───────────┬───────────┬──────────────┘
                           │           │           │
                ┌──────────▼──┐ ┌──────▼─────┐ ┌───▼─────────────┐
                │ markitdown  │ │ GHA bulk   │ │ structured/     │
                │ sidecar     │ │ worker     │ │ graph adapters  │
                │ (≤25 MB)    │ │ (>25 MB,   │ │ (s6.1 pipeline) │
                │             │ │ nightly)   │ │                 │
                └──────┬──────┘ └─────┬──────┘ └────────┬────────┘
                       │              │                 │
                       └──────┬───────┘                 │
                              ▼                         ▼
                ┌─────────────────────────┐  ┌────────────────────┐
                │  ingest-callback (HMAC) │  │ raw_records →      │
                │  chunks + parser meta   │  │ staged_records →   │
                └────────────┬────────────┘  │ canonical_facts    │
                             │               └─────────┬──────────┘
                             ▼                         │
                ┌────────────────────────┐             │
                │ indexer fan-out (W9.1) │◄────────────┘
                │ vector|lexical|sql|kg  │
                │ |timeseries|metadata   │
                └────────────┬───────────┘
                             ▼
                ┌────────────────────────┐
                │ ingest-search +        │
                │ retrieval contracts    │
                │ (per consumer surface) │
                └────────────────────────┘
```

Every transition emits a row to `ingested_file_events` (append-only) and, for structured paths, `ingest_events`.

---

## 3. Sources & capture

| Source | Trigger | Auth | Notes |
|---|---|---|---|
| `upload` | Operator UI / API | operator JWT | bytes already in `ingested-files` bucket before calling `ingest-file` |
| `inbox` | Operator Inbox attachment | service token | classifier promotes attachment, fans into ingest |
| `notebook` | Notebook entry attachment | operator JWT | same path as upload, different `source` tag for analytics |
| `engagement-intake` | Engagement wizard | operator JWT | contracts, RFPs, requirements — usually forced `sidecar` |
| `gha-bulk` | Nightly worker re-tries / pre-staged batches | `AWIP_SERVICE_TOKEN` | `>25 MB` files and retry queue |
| `scheduled-pull` (W9.4) | Cron + per-user OAuth | per-connector | deferred |

Storage convention: `ingested-files/<engagement_id>/<sha256>.<ext>`, private bucket, operator-only RLS on `storage.objects`.

---

## 4. Dedup & idempotency

- **File-level**: unique `(engagement_id, sha256)` where `engagement_id is not null`; partial unique `(sha256) where engagement_id is null` for global staging.
- **Chunk-level**: unique `(file_id, chunk_index)` — `ingest-callback` is upsert.
- **Endpoint-level**: `Idempotency-Key` required on every write; body-hash mismatch → `409` (see `awip-api` pattern).
- **Adapter-level** (structured): `raw_records (adapter_id, idempotency_key)` unique — replays don't duplicate facts.

Effects:
- Re-uploading the same bytes returns the existing row + `route: "duplicate"`; no re-parse, no re-embed cost.
- Sidecar retries on the same `(file_id, chunk_index)` are safe.

---

## 5. Classification & routing

In `ingest-file` after dedup (see `_shared/contracts/ingest-file.ts`):

| Condition | Route | Status | Parser |
|---|---|---|---|
| existing `(engagement_id, sha256)` | `duplicate` | (existing) | (existing) |
| `force_route` provided | (as given) | derived | derived |
| CAD/FM extension (DWG, RVT, IFC, NWD, SKP, STEP, …) | `metadata_only` | `metadata_only` | `metadata_only` |
| MIME not in markitdown allow-list | `metadata_only` | `metadata_only` | `metadata_only` |
| `size_bytes > 25 MB` | `gha-bulk` | `pending` | (nightly) |
| structured feed (CSV/Parquet/JSON-LD with declared adapter) — W9.1 | `structured-adapter` | `pending` | `adapter:<name>` |
| RDF / property-graph dump — W9.3 | `graph-adapter` | `pending` | `adapter:<name>` |
| else | `sidecar` | `pending` | `markitdown` |

Markitdown allow-list (prefixes): `application/pdf`, `application/vnd.openxmlformats-officedocument*`, `application/vnd.ms-*`, `application/msword`, `application/vnd.ms-outlook`, `message/rfc822`, `text/*`, `image/*` (OCR), `audio/*` (transcription).

CAD/FM policy (v1): store + index metadata only. Adapter slot for W9.2.

---

## 6. Parsing tiers

### 6.1 markitdown sidecar (interactive, ≤25 MB)
- Python container, holds pandoc/libreoffice/tesseract/ffmpeg hot.
- HMAC-signed callback (`APPROVAL_CALLBACK_SECRET`, `x-approval-signature` = hex sha256, prefix `sha256=` optional).
- Chunking: aim 1500 chars, hard cap 20000; split heading → paragraph → sentence; preserve `page`, `section`, `sheet` metadata.
- Heartbeat: optional `parsing` status + empty chunks every 5 min → updates `last_heartbeat_at`.
- See `docs/runbooks/ingest-sidecar.md`.

### 6.2 GHA bulk worker (nightly, >25 MB or retry queue)
- `.github/workflows/ingest-bulk.yml` + `scripts/ingest-bulk-worker.py`.
- Concurrency 1, 50-file cap per run, claims rows via `attempts < max_attempts` lock.
- Same HMAC contract as sidecar (raw hex, no `sha256=` prefix).

### 6.3 Metadata-only
- Row written, no chunks, no embeddings. Filename / MIME / size / declared discipline indexed for `ingest-search` filename hits.
- CAD/FM, unsupported MIME, or operator-forced.

### 6.4 Structured adapters (W9.1, s6.1/t1 schema already landed)
- `raw_records → staged_records → canonical_facts` with DB-enforced invariants (forbid update/delete on canonical, partial unique on live row).
- Conflicts raise `fact_conflicts` for triage; never overwrite silently.
- See `mem/features/ingest-pipeline-schema.md`.

### 6.5 Graph adapters (W9.3)
- Triples / property-graph payloads → `graph_nodes` + `graph_edges` (W9.3 migration).
- Same `raw_records` audit; vector index optional on node embeddings.

---

## 7. Multiple indexing methods

Single file may fan out to multiple indexes. Indexer is invoked from `ingest-callback` once chunks land (or directly by adapters for non-chunk payloads).

| # | Index | Store | Built from | Best for | Backed today? |
|---|---|---|---|---|---|
| 1 | **Dense vector (semantic)** | `ingested_file_chunks.embedding` `vector(1536)` HNSW cosine | markdown chunks via `google/gemini-embedding-001` | "find chunks meaning X" | ✅ shipped |
| 2 | **Lexical / BM25** | `tsvector` column + GIN on `ingested_file_chunks.content` | same chunks, `to_tsvector('english', content)` | exact terms, codes, identifiers | ⏳ W9.1 |
| 3 | **Filename / metadata** | btree + trigram on `filename`, `mime`, `declared_discipline`, `metadata` jsonb path-ops | `ingested_files` row at insert | "which doc is the MEP spec?" | ⏳ W9.1 |
| 4 | **Hierarchical / structural** | `ingested_file_chunks.metadata` (`page`, `section`, `sheet`, `heading_path[]`) + jsonb GIN | parser output | "section 3.2 of contract Y" | partial — fields written, no index |
| 5 | **Structured / SQL** | `canonical_facts` + per-domain materialised views | `raw_records → staged_records` adapters | "all line items > £10k from supplier Z" | schema ready (s6.1), adapters W9.1 |
| 6 | **Graph / KG** | `graph_nodes` + `graph_edges` (W9.3) + optional vector on node label | RDF / property-graph / extracted entities | "all stakeholders connected to risk R" | ⏳ W9.3 |
| 7 | **Time-series** | `time_series_points (entity_id, ts, metric, value)` + brin on ts | CSV/XLSX numeric sheets, telemetry feeds | "schedule variance over time" | ⏳ W9.1 |
| 8 | **Provenance / lineage** | `ingested_file_events` + `ingest_events` + `canonical_facts.source_mapping_id` | every write | "where did this fact come from?" | ✅ shipped |

### 7.1 Hybrid retrieval

`ingest-search` today = pure vector. W9.1 upgrades to **hybrid**:

1. Vector top-`k` (currently 8, max 50) over `match_ingested_chunks`.
2. BM25 top-`k` over `tsvector` (deferred until corpus > 10k chunks per engagement — gate is a hard rule, not a vibe).
3. Reciprocal Rank Fusion (RRF, `k=60`) merges the two lists.
4. Optional cross-encoder rerank (off by default; cost-gated by `tool_policy_rules`).
5. Metadata filter pass (`domain_ids`, `declared_discipline`, `mime`) applied **before** vector search, not after — keeps recall honest.

Tunables live in `retrieval_contracts` per consumer surface (RAG vs copilot vs validation), so we don't ship one global setting.

### 7.2 Embedding policy

- Default model: `google/gemini-embedding-001`, `dimensions=1536`, batched 32 chunks per call.
- Model + dims stamped on every chunk (`embed_model`) so a future model swap can coexist with old rows.
- Re-embed jobs run only when `embed_model` differs from current default AND the row is queried (lazy) — keeps cost bounded.
- Night window (22:00–06:00 UTC) routes embeddings through Lovable AI Gateway cheap-model policy when available.

### 7.3 Chunking policy

- Markdown-aware split: heading → paragraph → sentence.
- Target 1500 chars, hard cap 20000 (validator), max 2000 chunks/file (split file upstream otherwise).
- Overlap 100 chars between adjacent chunks of the same section to preserve sentence boundaries for cross-chunk retrieval.
- `metadata.heading_path` = `["Section 3", "3.2 Mechanical", "3.2.1 HVAC"]` so hierarchical filters work without re-parsing.

---

## 8. Data model (current + planned)

Current (W9.0, shipped):

- `ingested_files` — one row per file, dedup `(engagement_id, sha256)`, lifecycle status, attempts/heartbeat for worker reliability.
- `ingested_file_chunks` — markdown + `vector(1536)` HNSW; `metadata` jsonb.
- `ingested_file_events` — append-only audit.
- `match_ingested_chunks(query_embedding, engagement_id, domain_ids[], match_count)` — security-definer RPC.

Planned (W9.1+):

- `ingested_file_chunks.tsv` `tsvector` generated column + GIN.
- `ingested_files.filename_trgm` index (`pg_trgm`).
- `time_series_points` — `(entity_id uuid, ts timestamptz, metric text, value numeric, source_file uuid, …)` + BRIN on `ts`.
- `graph_nodes` / `graph_edges` (W9.3).
- `retrieval_contracts` already exists — register one per consumer surface.

All new public tables follow the standard pattern: explicit `GRANT`, `ENABLE RLS`, operator/admin policies via `has_role()`.

---

## 9. Edge functions & contracts

| Function | Auth | Idempotency key | Notes |
|---|---|---|---|
| `ingest-file` | operator JWT or service token | `(engagement_id, sha256)` | classifies + writes row; never parses |
| `ingest-callback` | HMAC over body (`APPROVAL_CALLBACK_SECRET`) | `(file_id, chunk_index)` upsert | accepts `parsed` / `metadata_only` / `failed`; embeds chunks in batches |
| `ingest-search` | operator JWT or service token | n/a (read) | embeds query, calls `match_ingested_chunks`; W9.1 adds hybrid path |
| `ingest-adapter-run` (W9.1) | service token | `(adapter_id, idempotency_key)` | runs a structured adapter into `raw_records` |
| `ingest-graph-load` (W9.3) | service token | `(source, payload_sha)` | loads triples → `graph_nodes/edges` |

All wrapped with `withLogger`. Contracts live under `supabase/functions/_shared/contracts/`.

---

## 10. Retrieval contracts (per consumer)

Registered in `public.retrieval_contracts`. One row per (surface, version), pinning:

- index set (`vector`, `lexical`, `metadata`, `sql`, `graph`, `timeseries`)
- top-`k` per index + fusion strategy
- mandatory filters (`engagement_id`, `domain_id`)
- max latency budget + cache policy
- model + dims

Default surfaces:

| Surface | Indexes | Notes |
|---|---|---|
| `rag-default` | vector + lexical + metadata (RRF) | RAG corpus, copilot fallback |
| `validation-agent` | sql (canonical_facts) + vector | needs deterministic facts before prose |
| `conflict-triage` | sql (fact_conflicts) + lineage | no LLM in retrieval path |
| `copilot-chat` | vector + lexical (RRF), rerank off | latency-bounded, cost-gated |
| `operator-inbox-classifier` | metadata + lexical | tiny payloads, no vector |

See `docs/retrieval-contracts.md` for the contract schema and `mem/preferences/retrieval-shapes.md` for why each shape needs its own store.

---

## 11. Lifecycle, events, observability

- Every state transition writes `ingested_file_events` (`uploaded`, `parse_started`, `parse_heartbeat`, `parsed`, `chunked`, `embedded`, `failed`, `retry_queued`, `superseded`, `metadata_only`).
- Realtime publication: `ingested_files`, `ingested_file_events` (operator dashboards).
- `/admin/ingest-health` shows status counts, recent files, stuck/failed banners.

Sentinel checks (15-min cadence, see `mem/features/file-ingestion.md`):

| Check | Severity | Threshold |
|---|---|---|
| `ingest_files_stuck_parsing` | medium → high ≥5 | `status='parsing'` and `last_heartbeat_at < now() - 15min` |
| `ingest_files_failed_burst` | medium → high ≥10 | ≥3 failures in 24h |
| `ingest_chunks_unembedded` (W9.1) | medium | `embedding IS NULL AND status='parsed'` older than 1h |
| `ingest_callback_hmac_failures` (W9.1) | high | any spike — likely secret drift |

---

## 12. Security & isolation

- All public tables: operator/admin-only RLS via `has_role()`.
- Storage bucket `ingested-files`: private; objects scoped by path prefix `<engagement_id>/`; RLS on `storage.objects` mirrors operator policy.
- `ingest-callback` rejects unsigned bodies; accepts both prefixed (`sha256=…`) and raw hex signatures.
- Per-module service tokens may only ingest into capabilities they own (`callerOwnsCapability` check, post-audit hardening).
- No cross-engagement reads anywhere — `match_ingested_chunks` requires `engagement_id`, not optional.

---

## 13. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Sidecar crashes mid-parse | heartbeat stale > 15 min → sentinel | GHA worker reclaims (`attempts++`) up to `max_attempts` |
| Embedding 429 / 5xx | per-batch retry in `ingest-callback`; row stays `parsed` with `embedding IS NULL` | nightly re-embed sweep |
| HMAC mismatch | callback returns 401, no row written | sentinel fires; operator rotates `APPROVAL_CALLBACK_SECRET` |
| Duplicate upload during race | unique index returns existing row | `route: "duplicate"`, no side effects |
| Adapter conflict | `fact_conflicts` row, canonical not promoted | operator triages in `/governance`; `conflict_rules` resolve recurring patterns |

Rollback: see `docs/runbooks/rollback-tier3-audit-2026-06-11.md` pattern — every migration with new indexes/constraints ships with a pre-check + rollback SQL.

---

## 14. Cost model

Dominant costs:
1. Embeddings — Lovable AI Gateway, billed per input token. Mitigations: dedup, lazy re-embed, night-cheap model swap, chunk-size discipline.
2. Sidecar runtime — separate infra; not in Core's budget. Tracked as discussion_action.
3. GHA minutes — nightly worker, 50-file cap keeps runs under ~15 min.
4. Storage — private bucket, no CDN; retention policy deferred until W9 corpus settles.

Budget alerts (existing `credit_alerts` infra) cover embedding spend at 80% / 100% of projected month-end.

---

## 15. Roadmap

| Phase | Scope | Status |
|---|---|---|
| **W9.0** | File substrate, sidecar contract, GHA worker, vector search, `/admin/ingest-health`, sentinel | ✅ shipped |
| **W9.1** | Hybrid retrieval (BM25 + RRF), trigram/metadata indexes, structured adapter runtime, time-series store, retrieval contracts per surface | next |
| **W9.2** | CAD/IFC/BIM geometry adapters (DWG via ODA, IFC via IFC.js, RVT via Forge) | scoped |
| **W9.3** | Graph store + loader, KG-aware retrieval | scoped |
| **W9.4** | Per-user OAuth pulls (Drive / SharePoint / Dropbox / Gmail) | deferred |
| **W9.5** | Cross-encoder rerank, cost-gated per retrieval contract | deferred |

---

## 16. Open questions

1. Where to host the markitdown sidecar (Cloud Run vs Fly vs Render) — separate infra discussion.
2. Retention policy for raw bytes once chunks + embeddings exist — keep N days? hash-only after?
3. Whether to expose `ingest-search` results to the client copilot or only to server-side agents (default: server-side only).
4. Whether time-series should live in Postgres (BRIN) or a dedicated TSDB once volume crosses ~10M points/engagement.

---

## 17. References

- `supabase/functions/_shared/contracts/ingest-file.ts` — typed contract.
- `supabase/functions/ingest-file/index.ts`, `ingest-callback/index.ts`, `ingest-search/index.ts`.
- `docs/features/ingestion.md`, `docs/runbooks/ingest-sidecar.md`.
- `mem/features/file-ingestion.md`, `mem/features/ingest-pipeline-schema.md`, `mem/preferences/retrieval-shapes.md`.
- `docs/adr/0006-embedding-model-and-index.md` — embedding model + HNSW choice.
- `docs/retrieval-contracts.md` — per-surface contract schema.
