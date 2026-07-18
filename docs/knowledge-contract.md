# Knowledge Contract

**Status:** Binding architecture contract  
**Date:** 2026-07-18  
**Accepted by:** [ADR-0013](./adr/0013-knowledge-contract.md)  
**Related:** [Knowledge Fabric Architecture](./knowledge-fabric-architecture.md), [Current-State Mapping](./knowledge-contract-current-state.md)

## Purpose

This contract defines how information becomes knowledge in Verdent/AWIP.

It is not a schema design and it does not require one generic table. Existing domain-specific stores remain the owners of their data. Unification should happen through lifecycle fields, events, read models, retrieval contracts, and governance before any umbrella schema is considered.

## Lifecycle States

AWIP uses five knowledge lifecycle states:

1. **Raw information** - externally supplied or internally emitted material that has been received but not validated as knowledge.
2. **Candidate knowledge** - information that has been classified, linked to a source, and proposed for use, but still needs validation, approval, conflict resolution, or authority selection.
3. **Trusted knowledge** - information that has passed its domain refinery gates and may be retrieved, cited, reasoned over, or used by agents according to its retrieval contract.
4. **Superseded knowledge** - previously trusted knowledge that remains auditable but has been replaced by a newer trusted item.
5. **Retired knowledge** - information no longer active for retrieval because it is rejected, archived, quarantined, expired, tombstoned, legally restricted, or outside the current trust boundary.

## Raw Information

Raw information is material as received. It may be duplicated, stale, malicious, malformed, contextless, private, or false.

Examples:

- uploaded files;
- source-system exports;
- Companion messages;
- raw CSV payloads;
- webhook data;
- voice transcripts;
- emails;
- model outputs;
- GitHub or documentation imports.

Minimum requirements:

- source identity;
- received timestamp;
- payload or storage pointer;
- tenant/engagement scope where applicable;
- payload hash or immutable source reference where possible;
- retention and privacy metadata where applicable.

## Candidate Knowledge

Candidate knowledge is information the system has begun to shape into something useful but has not yet trusted.

Examples:

- `staged_records`;
- `fact_conflicts`;
- unresolved claims;
- pending lessons;
- extracted actions;
- proposed W10 doc memories;
- suggested graph edges;
- entity-resolution conflicts.

Minimum requirements:

- link back to raw source;
- classification or type;
- proposed subject/entity where applicable;
- validation status;
- confidence dimensions, not one generic confidence score;
- approval or authority requirement;
- contradiction/conflict state when disagreement is detected.

## Trusted Knowledge

Trusted knowledge is eligible for retrieval under declared contracts.

Examples:

- live `canonical_facts`;
- accepted `lessons`;
- active authority-winning `claims`;
- approved W10 document memories;
- confirmed graph edges;
- approved lifecycle documents;
- accepted governance links.

Minimum requirements:

- provenance chain;
- owning store and owner/authority;
- effective date or validity window where applicable;
- retrieval contract or access rule;
- audit/event trail;
- supersession or retirement path.

## Superseded Knowledge

Superseded knowledge remains part of the audit trail and may still be cited historically, but it is not the live answer.

Examples:

- `canonical_facts.superseded_by`;
- `source_mappings.superseded_by`;
- `tenant_nodes.superseded_by`;
- `claims.supersedes_id`;
- OKR supersession;
- future document revisions and doc-memory supersession.

Minimum requirements:

- pointer to successor where possible;
- event explaining the supersession;
- no hard delete in normal operation;
- retrieval defaults exclude superseded rows unless explicitly historical.

## Retired Knowledge

Retired knowledge is inactive for normal retrieval.

Examples:

- rejected lessons;
- dismissed conflicts;
- archived files;
- tombstoned records;
- quarantined ingests;
- expired/voided claims;
- legally held records excluded from deletion but not necessarily from retrieval.

Minimum requirements:

- retirement reason;
- actor or system that retired it;
- timestamp;
- retention/legal-hold handling;
- explicit retrieval behaviour.

## Provenance Contract

Every knowledge-bearing object must preserve a chain that can answer:

- Where did this come from?
- Who or what transformed it?
- What validation or approval was applied?
- What conflicts were raised?
- What authority made it trusted?
- What has superseded or retired it?

For structured ingestion, the target chain is already close to:

```text
raw_records
  -> staged_records
  -> canonical_facts OR fact_conflicts
  -> ingest_events
```

For conversation-derived knowledge, the required target chain is:

```text
companion_messages
  -> candidate lesson / claim / decision / action / question
  -> evidence pointer to source turn
  -> approval or authority decision
  -> trusted store OR rejected/parked state
```

For W10 document knowledge, the required target chain is:

```text
ingested_files
  -> lifecycle approval
  -> chunks / anchors
  -> proposed doc memories / graph edges / canonical facts
  -> operator disposition or policy gate
  -> trusted memory / graph / fact
```

## Authority And Approval

Authority answers "who wins?". Approval answers "may this be used?".

They are related but not interchangeable.

- Authority is modelled through ontology, decision authorities, claims, source mappings, conflict rules, and domain-specific resolver rules.
- Approval is modelled through human or policy gates such as approved mappings, document lifecycle, approval queues, lesson acceptance, and conflict resolution.
- A candidate can be valid but unapproved.
- A candidate can be approved for one retrieval context and excluded from another.
- An AI model cannot make information trusted merely by generating it.

## Contradiction Contract

Contradiction is a first-class state, not an error condition to hide.

The platform must preserve and surface:

- fact conflicts between incoming and live canonical values;
- truth conflicts between competing claims;
- entity-resolution conflicts where a source cannot be safely attached to one entity;
- future W10 graph or document-memory contradictions.

Conflict resolution must be auditable. Auto-resolution is allowed only when a versioned rule exists and the event trail records the rule.

## Confidence Dimensions

Do not collapse confidence into one score. At minimum, keep these dimensions conceptually separate, even where the current schema does not yet have fields for all of them:

| Dimension | Question | Examples |
|---|---|---|
| Source reliability | Is this source normally authoritative for this field? | `decision_authorities.weight`, approved source mapping |
| Extraction confidence | Did the parser/model extract the value correctly? | entity resolver score, doc-memory extraction confidence |
| Validation confidence | Does the value satisfy schema/domain checks? | staged validation status, parser errors |
| Truth confidence | Is this the current winning assertion? | `resolve_truth()`, conflict state |
| Currentness | Is it still fresh enough for use? | validity windows, source cadence, retention state |
| Retrieval trust | Is this item allowed in this consumer context? | retrieval contract, document lifecycle approval |
| Usage confidence | Has use of this knowledge produced accepted outcomes? | lesson effectiveness, future experience traces |

Any future schema should prefer named dimensions over a single `confidence` column unless that column is explicitly scoped.

## Ownership

Every trusted item needs an owner in one of these forms:

- human owner/operator;
- source-system owner;
- domain authority rule;
- module or capability owner;
- system owner for immutable generated events.

Ownership determines who may approve, supersede, retire, or challenge the item. Absence of ownership is itself a gap that should block promotion to trusted knowledge for high-consequence uses.

## Retrieval Contract

Trusted knowledge is not automatically visible to every consumer. Retrieval must respect:

- tenant/engagement scope;
- approval state;
- lifecycle state;
- sensitivity/privacy/PII handling;
- retrieval shape: prose, hierarchical document, tabular, graph, relational, or time-series;
- token/cost budget;
- freshness window.

Existing `retrieval_contracts` are the right direction and should become the default declaration path for new knowledge consumers.

## Domain Refinery Contract

Each domain refinery must declare:

- source adapters;
- raw input shape;
- candidate state owner;
- validation rules;
- authority rules;
- approval gates;
- conflict rules;
- promotion criteria;
- supersession/retirement behaviour;
- retrieval contract(s);
- audit/event tables.

FM is the first domain. W10 corporate knowledge ingestion is the first full proof.

## Explicitly Rejected

- Creating a generic `knowledge_items` table before the existing stores have a clear lifecycle mapping.
- Treating vector embeddings as the knowledge core.
- Treating model output as trusted knowledge without provenance and authority.
- Treating chat history as memory without a candidate/promote/reject lifecycle.
- Making model routing the centre of the product.
- Moving "who acts when" logic into Core.

