# Phase 5 — Entity & Tenant Resolution: Open Questions

**Status: 🟢 ALL LOCKED — 2026-05-23.** Mirrored as `decision` comments on `phase-5/s5.1/open-questions` (now `done`). Source of truth for any future challenge.

---

## 1. 🟢 What IS a `tenant_node`?
**Decision:** Single recursive table with `kind` enum (`org` | `team` | `project` | `individual`) and `parent_id`. RLS walks closure via the universal predicate (s5.2/t4).

## 2. 🟢 Tree, DAG or set?
**Decision:** **DAG**, modelled as `tenant_nodes` (tree-shaped via `parent_id`) **plus** `tenant_node_memberships` join for shared/cross-org nodes. The physical ancestry-storage mechanism (closure table vs `ltree` vs `ancestry_ids[]` vs recursive CTE) stays open in [ADR-0003](./adr/0003-tenant-node-ancestry-storage.md) — current ADR lean is **option 4 (denormalised `ancestry_ids[]`)**; benchmark before s5.2 locks.

## 3. 🟢 Canonical identity key?
**Decision:** Operator-issued UUID is canonical. External ids (domain, LEI, Companies House, Stripe, HubSpot) are aliases with `kind` + `confidence`. No external system owns our identity.

## 4. 🟢 Day-one alias types?
**Decision:** `email_domain`, `display_name`, `lei`, `companies_house_number`, `free_text`. `stripe_customer_id` and `hubspot_id` deferred to Phase 7 (Connector Marketplace).

## 5. 🟢 Scoring approach?
**Decision:** **Deterministic-only for v1** (Levenshtein + exact match + domain normalisation). Auditable, zero model spend. AI tiebreaker added later via a `decision_authority` rule if fuzzy-band conflicts arise in practice.

## 6. 🟢 Cross-tenant isolation invariant?
**Decision:** **Both.**
- (a) Every multi-tenant table carries `tenant_node_id`; universal RLS predicate (s5.2/t4) walks closure.
- (b) Service-token callers pinned to one tenant; only operator JWTs may cross.
- Test suite (s5.1/t5) proves both.

## 7. 🟢 Conflict resolution UX?
**Decision:** **Async with provisional id.** Caller gets UUID + `status='pending'`; row written under pending flag; operator approves via `entity_resolution_conflicts` queue surfaced on `/governance`. Sync 409s would break ingest throughput.

## 8. 🟢 Alias revocation?
**Decision:** **Soft flag by default** (`revoked_at` / `revoked_reason` / `revoked_by`, downstream untouched). Aligned with [ADR-0004](./adr/0004-alias-revocation-cascade.md)'s locked **hybrid**: admin-only `hardRevoke=true` escape hatch for compliance/security cases. Bulk re-resolve (s5.3/t3) is an opt-in operator-triggered job, not automatic.

## 9. 🟢 Merge/split authority?
**Decision:** **Operator-only**, mirrored as a `discussion_action` with `risk='critical'` (Night Agent hard-blocked). New `decision_authorities` rules to seed in s5.1/t1 migration:
- `tenant_node.merge` → operator exclusive
- `tenant_node.split` → operator exclusive
- `tenant_node.identity` → operator (matches default)

## 10. 🟢 Retrieval-shape scope?
**Decision:** **Punted to Phase 6.** New task `s6.1/t0 — Retrieval-shape declaration` created (`order=0`, `kind=research`). Phase 5 scope = entity model only.

---

## Cascading consequences (already actioned)

- `s6.1/t0` task created and slots in before any ingest table.
- `s5.1/t1` migration MUST seed the 3 `decision_authorities` rules above.
- ADR-0003 and ADR-0004 unaffected — both keep their existing leans/decisions.
- Retrieval-shape memory (`mem://preferences/retrieval-shapes`) remains the source for Q10 execution.

## Unblocked next

`s5.1/t1` (`tenant_nodes` schema) is now ready for a contract-first plan.
