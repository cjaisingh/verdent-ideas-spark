# Phase 5 — Entity & Tenant Resolution: Open Questions

These must be answered (or explicitly deferred with rationale) before `s5.1/t1` (`tenant_nodes` schema) is built. Each maps to one or more downstream tasks; leaving any unanswered will force a schema migration later.

Status legend: 🟢 answered · 🟡 in discussion · 🔴 unanswered

---

## 1. 🔴 What IS a `tenant_node`?
The label is ambiguous. Pick one:
- **(a)** A row representing **one customer organisation** (Acme Ltd) with sub-nodes for departments/teams.
- **(b)** A row representing **any addressable unit in the tenancy graph** (org, team, project, individual) — i.e. nodes are recursive.
- **(c)** Both, distinguished by a `kind` enum.

→ Drives `tenant_nodes` columns (t1), `resolve_entity` semantics (t3), and whether RLS predicates (s5.2/t4) walk a tree or hit a flat row.

## 2. 🔴 Is the tenancy graph a tree, DAG, or set?
- Tree: one parent only (clean, but no shared projects).
- DAG: nodes can have multiple parents (shared projects across orgs — needed for consultancies, holdcos).
- Set: flat with explicit `member_of` rows.

→ Drives ADR-0003 (s5.2/t3) — ancestry storage decision.

## 3. 🔴 What is the canonical identity key?
For a `tenant_node`, what makes two records the **same** entity?
- Domain (`acme.com`)?
- LEI / company number?
- Operator-issued UUID only, with everything else as an alias?

→ Drives `tenant_node_aliases` (t2) shape and `resolve_entity` priority order (t3).

## 4. 🔴 Alias types — which sources do we accept on day one?
Candidates: email domain, display name, LEI, Companies House number, Stripe customer ID, HubSpot ID, free-text. Day-one MVP = ?

→ Drives t2 schema + scorer weights (s5.2/t1).

## 5. 🔴 Scoring: deterministic-only, or AI-augmented?
- Deterministic only (regex / exact match / Levenshtein) — auditable, no model spend.
- AI tiebreaker when score is in a "fuzzy band" — flexible but adds claim arbitration.

→ If AI-augmented, claims go through `resolve_truth` (W7.2) and need a `decision_authority` rule for `tenant_node.identity`.

## 6. 🔴 Cross-tenant isolation — what's the leak test?
What is the explicit invariant `s5.1/t5` must prove?
- "User in tenant A cannot SELECT any row tagged tenant B" — strict, requires every table to carry `tenant_node_id`.
- "Operator can resolve cross-tenant; modules cannot" — requires service-token gating.
- Both?

→ Drives the universal RLS predicate helper (s5.2/t4) and the test suite scope.

## 7. 🔴 Conflict resolution UX — sync or async?
When `resolve_entity` finds ≥2 candidates above threshold:
- **Sync:** caller gets `409` + a `conflict_id`; nothing is written until operator approves.
- **Async:** caller gets a provisional ID, row is written under `pending` flag, operator approves later via `entity_resolution_conflicts` queue.

→ Drives t6 + alias approval flow (s5.3/t1).

## 8. 🔴 Alias revocation — soft flag or cascade?
When an alias is revoked (wrong match), do dependent rows get re-resolved?
- Soft flag only (ADR-0004 default) — alias rows carry `revoked_at`, history preserved, downstream untouched.
- Cascade with `bulk_re_resolve` job (s5.3/t3) — runs over historical claims.

→ Already pre-decided as soft flag per ADR-0004 stub. Confirm.

## 9. 🔴 Merge vs split — who is allowed?
`tenant_node` merge/split (s5.3/t4) is destructive. Operator-only? Or also AI with operator sign-off in `discussion_actions`?

→ Drives `decision_authority` rule and surfaces this in `/governance`.

## 10. 🔴 Retrieval shape for Phase 6 ingest
Per `mem://preferences/retrieval-shapes`, Phase 6 ingest needs to declare which of the 5 retrieval shapes each fact-type uses **before** picking a store. Is that declaration in scope for Phase 5 (entity model influences canonical shape) or punted to Phase 6 kickoff?

→ Affects `canonical_facts` pattern (s6.1/t3) and resolver decision log retention policy (s5.2/t5).

---

## Process

- Each question is mirrored as a `question` comment on `roadmap_tasks` row `phase-5/s5.1/open-questions`.
- When answered, change the leading dot to 🟢, add the decision inline, and resolve the comment via the `/roadmap` task drawer.
- `🔴 unanswered` count on this task = blocker count for opening `s5.1/t1`.
