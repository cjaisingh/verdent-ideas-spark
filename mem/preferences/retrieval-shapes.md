---
name: Retrieval shapes per data kind
description: Phase 5/6 prep — different data shapes need different memory stores, not just different parsers. Source: Nate's Newsletter video on agent memory infra war.
type: preference
---

When Phase 5 (entity resolution) or Phase 6 (ingest & canonicalisation) opens,
do not default to "chunk everything → embed → vector search". The retrieval
shape must match the data shape, or the agent burns tokens on rediscovery.

## The five shapes

| Shape | Example sources | Wrong move | Right move |
|---|---|---|---|
| Conversational / unstructured prose | docs, emails, transcripts, lessons | — | Classic RAG (vectors + FTS). We have it: `awip_doc_chunks`. |
| Long structured docs | leases, SFG20, ISO standards, BIM specs | Chunk + embed (loses hierarchy) | Hierarchical index (PageIndex pattern) — store table-of-contents, retrieve by section path |
| Tabular numeric | BMS/IoT batches, finance, sensor exports | Embed rows as text | Query the table directly. Agent gets a NoQL/SQL contract, not chunks. Foundation: `canonical_facts`. |
| Relational / entity graph | tenant trees, governance links, capability manifest | Flatten to text | GraphRAG-style traversal. Foundation: `tenant_nodes`, `governance_links`. |
| Time-series / streaming | sensor feeds, log streams | Single-shot RAG | Windowed query with late-arrival handling. Not built. |

## Rule

**Declare a retrieval contract per agent surface before picking a store.**
Mirrors `mem://preferences/contract-first` — same discipline, applied to
memory reads. Lives in `supabase/functions/_shared/contracts/<agent>.ts`
alongside the input contract. Must specify: shape, return schema, token
budget, freshness window.

## Why bigger context windows don't fix this
- Cost scales linearly per call; rediscovery scales per run.
- Models still attend poorly to the middle of huge contexts.
- Hierarchical/graph/tabular structure is lost when serialised into prose.

## When to act
- Phase 5/6 sprint open → load this file before drafting ADR-0006 (embedding
  model) and the source taxonomy decision.
- Audit `ai_usage_log` for rediscovery patterns before designing the new
  stores — measure the problem first.

## Source
Nate's Newsletter, "AI agent memory infrastructure war" (YouTube
`lqiwQiDglGk`). Vendors named: Pinecone Nexus (NoQL contract), PageIndex
(hierarchical), SAP/Dremio/Prior Labs (tabular), Microsoft GraphRAG
(relational).
