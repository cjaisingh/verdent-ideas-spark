---
name: Hybrid retrieval (W9.1)
description: BM25/lexical + dense vector fusion via RRF on ingested_file_chunks; ingest-search default mode is hybrid
type: feature
---

W9.1 added a lexical leg to ingestion retrieval. `ingested_file_chunks.content_tsv`
is a generated `tsvector` (English) with a GIN index. Search goes through
`public.hybrid_match_ingested_chunks(query_embedding, query_text, p_engagement_id,
p_domain_ids, match_count, rrf_k, candidate_pool)` — SECURITY INVOKER, RLS on
files+chunks still applies.

Fusion = Reciprocal Rank Fusion. Default `rrf_k=60`, `candidate_pool=50`. Each
leg opt-out: `query_embedding IS NULL` skips dense, blank `query_text` skips
lexical. Rows with `rrf_score = 0` (matched neither leg) are filtered.

`ingest-search` edge fn defaults to `mode: "hybrid"`. Hits expose `similarity`
(dense cosine), `lexical_score` (ts_rank_cd), `dense_rank`, `lexical_rank`,
`rrf_score`. Sort key in hybrid mode is `rrf_score`.

"BM25" in product wording = `ts_rank_cd` here. True BM25 (pg_search / paradedb)
is a W9.2 swap; the RRF contract and `hybrid_match_ingested_chunks` signature
stay stable across that swap.
