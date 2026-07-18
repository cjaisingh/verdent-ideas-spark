# ADR-0013: Knowledge Contract

- **Status:** accepted
- **Date:** 2026-07-18
- **Supersedes:** none
- **Related:** [Knowledge Contract](../knowledge-contract.md), [Knowledge Fabric Architecture](../knowledge-fabric-architecture.md)

## Context

AWIP Core began as the system of record for OKRs, capabilities, and immutable events. The repository now also contains ingestion, canonical facts, source mappings, conflicts, entity resolution, decision authority, claims, governance links, lessons, document ingestion, RAG, Companion conversations, AI usage logging, cost tracking, and W10 corporate knowledge ingestion plans.

Those stores are individually useful, but the platform now needs one binding contract for how information becomes knowledge. Without that contract, the system risks accumulating multiple memory mechanisms that disagree on lifecycle, provenance, approval, ownership, contradiction handling, and confidence.

## Decision

Adopt [the Knowledge Contract](../knowledge-contract.md) as the governing architecture contract for all knowledge-bearing work. The contract defines five lifecycle states: raw information, candidate knowledge, trusted knowledge, superseded knowledge, and retired knowledge.

Existing domain-specific stores remain the owners of their data. Unification must happen through lifecycle semantics, provenance, authority, approval, contradiction handling, retrieval contracts, events, and read models before any umbrella schema is considered.

W10 corporate knowledge ingestion is the first full FM refinery proof. Companion is the first human-facing intake surface, but its durable output must move from chat-first memory toward evidence-backed candidates.

## Consequences

Easier:

- Existing ingestion and W10 work can be understood as one Knowledge Refinery architecture.
- Companion can be refactored toward candidate knowledge without inventing a separate memory model.
- Future domain packs can reuse the contract while preserving domain-specific stores.
- Architecture reviews can reject features that bypass provenance, authority, approval, or conflict state.

Harder:

- Some current stores must remain visibly fragmented until their lifecycle ownership is understood.
- UI changes must wait for the contract rather than simply moving "Knowledge" to the top of navigation.
- Confidence work becomes multi-dimensional rather than one generic score.
- Model routing and councils become runtime infrastructure, not the product narrative.

## Explicitly Rejected

- Creating a generic `knowledge_items` table before the existing stores have a clear lifecycle mapping.
- Treating vector embeddings as the knowledge core.
- Treating model output as trusted knowledge without provenance and authority.
- Treating chat history as memory without a candidate/promote/reject lifecycle.
- Making model routing the centre of the product.
- Moving "who acts when" logic into Core.

## Revisit Triggers

Revisit this ADR if:

- W10 cannot express document lifecycle, memory, graph, and FM reconciliation under the contract;
- a second non-FM domain cannot reuse the refinery contract without major changes;
- current-state mapping reveals an existing store that cannot be assigned a lifecycle owner;
- a future generic knowledge read model proves useful after at least two domain stores share stable lifecycle semantics.

