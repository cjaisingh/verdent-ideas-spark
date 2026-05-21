# ADR-0006: Embedding model + index choice for RAG

- **Status:** proposed
- **Date:** 2026-05-21

## Context

Phase 6's RAG split needs an embedding model and a vector index that match the expected corpus shape and the retrieval contracts declared in `supabase/functions/_shared/contracts/retrieval-*.ts`.

Not every retrieval contract uses vectors — `retrieval-resolver` is graph-first, `retrieval-validation-agent` is tabular, `retrieval-conflict-triage` is relational. Embeddings are mandatory only for `retrieval-ingest-concierge`'s fallback path and for the existing `awip_doc_chunks` prose store. This ADR scopes the model + index for those two.

### Model options

| Model | Dims | Cost (per 1M tokens) | Notes |
|---|---|---|---|
| `google/gemini-embedding-001` | 3072 (Matryoshka, truncatable) | ~$0.15 | Lovable AI Gateway default; English+code strong. |
| `openai/text-embedding-3-small` | 1536 (Matryoshka) | ~$0.02 | Cheapest; good baseline; weaker on long technical English. |
| `openai/text-embedding-3-large` | 3072 (Matryoshka) | ~$0.13 | Higher precision; comparable cost to Gemini. |
| `BAAI/bge-large-en-v1.5` self-host | 1024 | infra only | Sovereignty win; ops cost; latency unknown. |

### Index options

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

**TBD** — decide when sprint `s6.2` opens. Trigger: corpus-size estimate from the first real ingest plus a sovereignty posture call (see `mem://preferences/sovereignty-posture`).

Current lean: `google/gemini-embedding-001` at 1536 dims (Matryoshka-truncated) + `hnsw`. Matches the Lovable AI Gateway default, halves index size vs 3072 dims with marginal quality loss, and stays within reach of a future BGE self-host migration on the same column dimensionality.

## Consequences

To be filled in once the decision lands. Re-embedding is the migration cost — any model swap forces a full re-embed of the corpus, so the decision is sticky for 12+ months. Add `embedding_model_version` to whatever table holds the vectors so a future swap is trackable.
