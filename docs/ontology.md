# AWIP Ontology

> Canonical definitions of the 11 entities AWIP Core operates on.
> This document is the **source of truth**. The `/ontology` page renders this file verbatim.
> Any change here is a governance event — update memory and CHANGELOG.

For each entity:

- **Ownership** — who/what is responsible for its lifecycle
- **Lifecycle** — discrete states + allowed transitions
- **Mutation rules** — who can change what, and how
- **Authority source** — the table or system that defines truth
- **Audit** — where every change is recorded
- **Relationships** — what it points to or is pointed to by

---

## 1. Task

A unit of work that ships code, docs, or operational state.

- **Ownership** — `owner` (operator) or `system` (night agent / overnight runner)
- **Lifecycle** — `proposed → planned → in_progress → in_review → shipped` (terminal); side branches: `blocked`, `cancelled`
- **Mutation rules** — operator may transition any direction except into `shipped` (which requires a sign-off event); night agent may move `planned → in_progress → in_review` only when `night_eligible=true`
- **Authority source** — `public.roadmap_tasks`
- **Audit** — `public.roadmap_task_activity` (one row per field change, written by `log_roadmap_task_activity` trigger)
- **Relationships** — belongs to `roadmap_phases`; sourced from `discussion_actions.promoted_task_id`; emits to `okr_node_events` when linked to an OKR

---

## 2. Finding

A factual observation about a defect, drift, risk, or improvement opportunity.

- **Ownership** — emitter system (Sentinel, Deep Audit, App Walkthrough, AWIP Reviews) or operator (manual entry on Roadmap)
- **Lifecycle** — `open → triaged → resolved` (terminal); `dismissed` (terminal, requires reason)
- **Mutation rules** — emitters write once and never update text; operators may triage, dismiss, or promote to a `discussion_action`
- **Authority source** — `public.sentinel_findings` (live monitoring) and `public.roadmap_findings` (review-time)
- **Audit** — `public.sentinel_finding_events`, `public.roadmap_finding_discussions`
- **Relationships** — may be promoted to `discussion_actions` or `lessons`; references the source review (`morning_reviews`, `deep_audits`, `awip_reviews`) via `source_*` columns

---

## 3. Lesson

A durable, human-validated rule extracted from one or more findings or operator corrections.

- **Ownership** — `Lessons Loop` (weekly synthesis) writes candidates; operator promotes
- **Lifecycle** — `candidate → accepted` (terminal); `rejected` (terminal); `superseded` when a newer lesson replaces it
- **Mutation rules** — append-only after `accepted`; corrections create a new lesson and mark the old one `superseded_by`
- **Authority source** — `public.lessons`
- **Audit** — the table itself is append-only; status flips logged via `update_updated_at_column` and reviewed in `/admin/lessons`
- **Relationships** — sourced from `findings`, `audits`, `awip_reviews`; consumed by Companion RAG (`awip_doc_chunks`)

---

## 4. Approval

A gated decision-point: someone must say yes before state changes downstream.

- **Ownership** — `owner` field on the underlying `discussion_action`; defaults to operator
- **Lifecycle** — `pending → approved` or `pending → rejected` (both terminal); `expired` when `due_at` passes without action
- **Mutation rules** — only the named owner (or admin) may approve/reject; approvals never reopen — a new approval row is created instead
- **Authority source** — `public.discussion_actions` with `subject_type` indicating what is being approved
- **Audit** — `public.discussion_action_events` records every status flip with actor + timestamp
- **Relationships** — gates promotion of a `task`, sign-off of a `roadmap_phase`, or merge of a `capability_promotion`

---

## 5. Event

An immutable timestamped record of something that happened.

- **Ownership** — emitter system or trigger; never operator-written by hand
- **Lifecycle** — single state: `recorded` (immutable). No edits, no deletes (purge only via retention).
- **Mutation rules** — INSERT-only. Any UPDATE/DELETE on an `*_events` table is a governance violation and must raise.
- **Authority source** — every `*_events` table in `public` (e.g. `okr_node_events`, `capability_events`, `discussion_action_events`, `sentinel_finding_events`, `roadmap_task_activity`)
- **Audit** — self (each event is its own audit record)
- **Relationships** — every event carries a `subject_type`/`subject_id` plus, post-W1, `correlation_id` and `parent_event_id` for lineage

---

## 6. Discussion

A threaded conversation about a finding, task, phase, or audit, that may extract structured `actions`.

- **Ownership** — opened by operator or by an emitter (e.g. Sentinel auto-opens on critical finding)
- **Lifecycle** — `open → resolved` (terminal); may have any number of `discussion_actions` extracted from it
- **Mutation rules** — comments append-only; only the discussion opener or an admin can mark `resolved`
- **Authority source** — `public.roadmap_finding_discussions` (the discussion) + `public.discussion_actions` (extracted items)
- **Audit** — `public.discussion_action_events` for every action mutation; the discussion thread itself is append-only
- **Relationships** — anchors to a `subject_type` (finding, phase, task, audit); spawns `actions`

---

## 7. Workflow

A scheduled or triggered sequence of work — typically a cron job + edge function + downstream events.

- **Ownership** — defined by an operator via SQL `cron.schedule`; runs as `system`
- **Lifecycle** — `enabled ↔ disabled` (toggleable); each invocation has a transient `running → succeeded|failed` lifecycle visible in `cron.job_run_details`
- **Mutation rules** — schedule changes only via `update_managed_cron_schedule()`; toggle only via `set_managed_cron_active()`; both authorize on `operator` role and audit to `memory_audit_log`
- **Authority source** — `cron.job` (postgres), backed by code in `supabase/functions/<name>/index.ts`
- **Audit** — `cron.job_run_details` (per run) + `memory_audit_log` (schedule/active changes) + `withLogger` output (per request)
- **Relationships** — emits `*_events` rows; reads/writes `findings`, `actions`, `tasks`, `lessons`, `reviews`

---

## 8. Roadmap item

A planning unit: a phase, a milestone, or a parent under which tasks live.

- **Ownership** — operator
- **Lifecycle** — `proposed → planned → active → shipped` (terminal); `cancelled` (terminal)
- **Mutation rules** — operator-only; status changes ripple to children (a shipped phase auto-closes its open tasks via app logic, not trigger)
- **Authority source** — `public.roadmap_phases` (phases) + `public.roadmap_tasks` (the work inside)
- **Audit** — `public.roadmap_task_activity` for tasks; phases via `update_updated_at_column`
- **Relationships** — phase has many tasks; phase has optional overnight runs (`roadmap_phase_overnight_runs`); tasks may link to a `discussion_action` via `promoted_task_id`

---

## 9. Sign-off

The terminal approval that moves a task or phase to `shipped`. A specialization of `Approval` with stricter rules.

- **Ownership** — operator (admin role required for production sign-off)
- **Lifecycle** — `requested → signed` (terminal); never reversible — to undo, open a new task
- **Mutation rules** — recorded as a `discussion_action` with `status='shipped'` and a non-null `signed_by`; trigger forbids unsetting `signed_by`
- **Authority source** — `public.discussion_actions` filtered by `status='shipped'`
- **Audit** — `discussion_action_events` (event_type='status_changed', to='shipped')
- **Relationships** — closes a `task` or `roadmap_phase`; may produce a `lesson` candidate

---

## 10. Action

An extracted, trackable to-do that came from a discussion, finding, review, or external CI signal.

- **Ownership** — `owner` field; defaults to operator who extracted it
- **Lifecycle** — `proposed → accepted → in_progress → done` (terminal); `dismissed` (terminal, requires reason); special: `night_eligible` flag controls whether Night Agent may pick it up
- **Mutation rules** — `risk='critical'` blocks `night_eligible=true` (trigger `enforce_night_eligibility_by_risk`); `risk='high'` requires `night_override_reason` to be night-eligible
- **Authority source** — `public.discussion_actions`
- **Audit** — `public.discussion_action_events` for every status, owner, due, priority, risk, or override change
- **Relationships** — extracted from `roadmap_finding_discussions`; may promote to a `task` via `promoted_task_id`; surfaces on Tomorrow Plan and Morning Review

---

## 11. Review

A scheduled, structured aggregation of evidence into a narrative document.

- **Ownership** — system (scheduled cron) or operator (ad-hoc)
- **Lifecycle** — `running → published` (terminal); `failed` (terminal, retryable by re-running the cron)
- **Mutation rules** — once `published`, the body is immutable; corrections create a new review record
- **Authority source** — `public.morning_reviews` (daily 06:00 UTC), `public.deep_audits` (weekly + monthly), `public.awip_reviews` (Mon 05:30 UTC pull from external repo); plus quarterly via `discussion_actions` with `subject_type='quarterly_review'`
- **Audit** — each table is append-only; the cron run is logged in `cron.job_run_details`
- **Relationships** — produces `findings` (interpretation layer); `findings` may produce `lessons` (durable layer); never overwrites underlying `events`

---

## 12. Tenant node

A recursive identity record for any addressable unit in the tenancy graph (organisation, team, project, or individual). Phase 5 foundation.

- **Ownership** — operator. Canonical identity is the operator-issued UUID; external references (email domain, LEI, Companies House, Stripe id, HubSpot id, free text) live as aliases in `tenant_node_aliases` with `kind` + `confidence`.
- **Lifecycle** — `pending → active → archived` (reversible: `archived → restored`); merge/split is operator-only and recorded as `discussion_actions` with `risk='critical'` (Night Agent hard-blocked).
- **Mutation rules** — operator-only at all access paths. Cross-tenant resolution requires an operator JWT; service-token callers are pinned to one tenant via the universal RLS predicate (Q6 invariant).
- **Authority source** — `public.tenant_nodes` (primary), `public.tenant_node_memberships` (DAG join for shared/delegated cross-org links), `public.tenant_node_aliases` (operator-approved aliases with hybrid soft/`hard_revoked` revocation per ADR-0004), `public.tenant_node_alias_embeddings` (semantic match support), `public.tenants` (top-level authoritative id registry).
- **Audit** — `public.tenant_node_events` (insert-only; written by `emit_tenant_node_event` trigger on `tenant_nodes` and `emit_tenant_alias_event` on `tenant_node_aliases`).
- **Authority arbitration** — three `decision_authorities` rules seeded operator-exclusive: `tenant_node.identity`, `tenant_node.merge`, `tenant_node.split`.
- **Ancestry storage** — `ancestry_ids uuid[]` column maintained by `tg_tenant_nodes_set_ancestry` trigger (ADR-0003 winner). DAG cross-edges via `tenant_node_memberships` are walked at query time, not materialised into `ancestry_ids`.
- **Relationships** — referenced by every multi-tenant table via `tenant_node_id`; aliases reference back via `node_id`; future canonical facts (Phase 6) attach via the same FK.

---



## Layer assignment (preview of W1.2)

| Layer | Tables (representative) |
|---|---|
| **Evidence** (immutable, append-only) | All `*_events` tables; `cron.job_run_details`; `ai_usage_log`; `awip_doc_chunks` |
| **Interpretation** | `sentinel_findings`, `roadmap_findings`, `discussion_actions`, `lessons`, `discovery_clusters` (W3) |
| **Narrative** | `morning_reviews`, `deep_audits`, `awip_reviews`, quarterly review docs |

**Inviolable rule:** narrative writers may never UPDATE or DELETE evidence rows. Enforcement lands in W1.2.

---

## Change log

- **2026-05-11** — Initial ontology lockdown (W1.1).
