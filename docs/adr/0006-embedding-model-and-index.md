# ADR-0006: Embedding model + index choice for RAG

- **Status:** accepted
- **Date:** 2026-05-21
- **Decision driver:** Phase 6 s6.2 unblocking — overnight runs were re-deriving the same question every night.

## Context

Phase 6's RAG split needs an embedding model and a vector index that match the expected corpus shape and the retrieval contracts declared in `supabase/functions/_shared/contracts/retrieval-*.ts`.

Not every retrieval contract uses vectors — `retrieval-resolver` is graph-first, `retrieval-validation-agent` is tabular, `retrieval-conflict-triage` is relational. Embeddings are mandatory only for `retrieval-ingest-concierge`'s fallback path and for the existing `awip_doc_chunks` prose store. This ADR scopes the model + index for those two.

### Model options considered

| Model | Dims | Cost (per 1M tokens) | Notes |
|---|---|---|---|
| `google/gemini-embedding-001` | 3072 (Matryoshka, truncatable) | ~$0.15 | Lovable AI Gateway default; English+code strong. |
| `openai/text-embedding-3-small` | 1536 (Matryoshka) | ~$0.02 | Cheapest; good baseline; weaker on long technical English. |
| `openai/text-embedding-3-large` | 3072 (Matryoshka) | ~$0.13 | Higher precision; comparable cost to Gemini. |
| `BAAI/bge-large-en-v1.5` self-host | 1024 | infra only | Sovereignty win; ops cost; latency unknown. |

### Index options considered

| Index | Build cost | Query cost | Best at |
|---|---|---|---|
| `hnsw` (pgvector) | high | low | < 10M vectors, low write rate, high query rate. |
| `ivfflat` (pgvector) | low | medium | rapid bulk ingest, periodic re-train. |

### Per-source chunk strategy

| Source | Chunk unit | Reason |
|---|---|---|
| Lease PDF | semantic section (clause-level) | preserves clause numbering for citation |
| SFG20 task | one chunk per task | tasks are atomic compliance units |
| Email thread | one chunk per message, with thread-id metadata | thread context restored at retrieval |
| Voice transcript | one chunk per utterance | turn-taking matters for downstream tagging |
| Canonical fact | NOT embedded | facts are tabular, queried via SQL — embedding them burns tokens |

## Decision

Use **`google/gemini-embedding-001` at 1536 dims** (Matryoshka-truncated via the `dimensions: 1536` request field) with a **pgvector `hnsw` index** (`vector_cosine_ops`) for both `awip_doc_chunks` and the Phase 6 ingest-concierge fallback store.

Rationale:

1. **Already on Lovable AI Gateway.** No new vendor, no new API key, no new spend bucket; calls flow through the existing `LOVABLE_API_KEY` + `ai_usage_log` mirror.
2. **1536 dims, not 3072.** Halves the on-disk index and roughly halves query cost for marginal quality loss on English+code (the only modality Phase 6 ships with). Matches `openai/text-embedding-3-small`'s default size, so a future swap is a zero-DDL migration — only a re-embed.
3. **`hnsw` over `ivfflat`.** Our expected Phase 6 corpus at launch is < 200k chunks (leases + SFG20 + internal docs), well inside hnsw's sweet spot, and write rate is low (bulk ingest at connector-onboarding time, then trickle). ivfflat's re-train overhead would dominate.
4. **BGE self-host deferred.** Sovereignty wins are real but ops cost is not. Revisit when (a) sovereignty posture flips to "must self-host embeddings" or (b) Gemini gateway cost exceeds €50/mo solely on embeddings.

### Mandatory column shape

```sql
embedding vector(1536) not null,
embedding_model_version text not null default 'gemini-embedding-001@1536'
```

The `embedding_model_version` column is non-negotiable — any future model swap must be trackable per row so partial re-embeds are possible.

### Mandatory index DDL

```sql
create index if not exists <table>_embedding_idx
  on <table> using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
```

`m`/`ef_construction` defaults are starting points; tune at corpus ≥ 100k chunks.

## Consequences

**Easier:**
- Phase 6 s6.2 (`canonical_facts` ingest concierge fallback path) and any new RAG surface can ship by referencing this ADR + the existing `<ai-embeddings>` knowledge file — no further design round.
- `awip_doc_chunks` migration to vectors is now a defined task (drop legacy column type, re-embed, rebuild index) rather than an open question.
- All embedding calls already flow through `logAiUsage` — cost tracking works on day one.

**Harder:**
- Re-embedding is sticky. Any model swap forces a full re-embed of the corpus; expect 12+ month commitment to `gemini-embedding-001`.
- 1536-dim truncation means we cannot directly compare against vectors stored at 3072 dims without re-embedding. Document this loudly anywhere the dimension is configurable.
- `hnsw` build cost grows non-linearly past ~1M vectors; need to revisit if any single store crosses that line.

**Explicitly accepted:**
- We are NOT embedding canonical facts. They are tabular and queried via SQL — see `mem://preferences/retrieval-shapes`.
- We are NOT supporting hybrid (vector + FTS) search in this ADR. Phase 6 ships with vector-only; FTS is a separate decision when retrieval quality complaints arrive.
- We are NOT picking a sovereign embedding model now. The BGE self-host option is deferred, not killed.

## Measured

| Date (UTC) | `embedding_spend_usd_30d` | `vector_row_count_max` | `hnsw_query_p95_ms` | `re_embed_jobs_30d` | Status |
|---|---|---|---|---|---|
| 2026-05-21 | 0 | 0 | 0 | 0 | green (pre-Phase-6 baseline — no `public.*` table has an `embedding` column yet) |

Baseline meaning: until Phase 6 ships an `embedding`-bearing table, `vector_row_count_max` and `hnsw_query_p95_ms` are structurally `0`, not "no data". The first non-zero spend row will start the real clock against the €50/mo intent (metric is USD because `ai_usage_log.cost_usd`).

## Revisit trigger

Re-open this ADR if any of: (a) embedding-only spend exceeds €50/mo on the Lovable AI Gateway (measured as `embedding_spend_usd_30d > 50`), (b) sovereignty posture flips to "embeddings must run on owned infra", (c) any single vector store crosses 1M rows, or (d) Gemini embedding API gets deprecated by Google.

> Measurement harness: see [`docs/adr/benchmarks.md § ADR-0006`](./benchmarks.md#adr-0006--embedding-model--index-revisit-instrumentation) and `scripts/adr-bench/adr-0006-embedding.ts`.

