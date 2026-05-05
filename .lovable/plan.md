# AWIP v1 — The OKR Substrate (Core)

## What this is

AWIP is built as **a constellation of Lovable projects**, not one monolith. Each module (CDP, agent, connector) will be its own project, registering itself with Core via a shared contract. v1 is the smallest version of that constellation: **two projects, one contract**.

- **AWIP Core** (this project) — OKR tree, capability manifest, operator view, contract endpoints. The spine every future module hangs off. **For v1, Core is also the orchestrator-by-default** — its contract endpoints are the only routing surface that exists.
- **Discovery AI** (existing project) — gets a small addition: queries Core during OKR drafting, hands off the finished tree to Core.

A dedicated **Control Plane** project will be added in v2, when the first acting module (CDP or agent) joins. Until then, orchestration = Core's endpoints + you, manually. v1's job is to make sure the v2 Control Plane is a clean addition, not a rewrite.

## Why this scope

1. The OKR tree must support **sub-OKRs spawning from parents** as the client's reality evolves. Versioned tree, not a list.
2. Discovery AI needs **draft-time awareness** of AWIP's capabilities. Capability manifest queryable from day one.
3. **Pre-customer, ~4 hours in.** v1 earns no right to act. Read-only operator view only.
4. **No real orchestrator yet** — but Core is designed so one can be added cleanly later.

---

## Part A — AWIP Core (this project)

### 1. OKR data model (the spine)

Lovable Cloud (Supabase). Tables:

- **`tenants`** — one per client engagement
- **`okr_nodes`** — the tree. `id`, `tenant_id`, `parent_id` (nullable), `kind` (`objective` | `key_result`), `title`, `description`, `status` (`draft` | `active` | `superseded` | `achieved` | `abandoned`), `version`, `superseded_by`, `spawned_from_reason`, `created_by` (`discovery_ai` | `awip` | `human`), `created_at`
- **`okr_measurement`** — for KR nodes: `metric_name`, `baseline`, `target`, `unit`, `cadence`, `attribution_rules` (jsonb), `data_sources` (jsonb), `required_capabilities` (text[])
- **`okr_node_events`** — append-only log of every OKR state change. The evolution history *and* the event stream a future Control Plane will subscribe to.

Sub-OKRs spawn by inserting a new node with `parent_id` set. Superseding sets old `status='superseded'`, `superseded_by=new_id`. Nothing is hard-deleted.

### 2. Capability manifest

Versioned registry that any future AWIP module (or Discovery AI) can query.

- **`capabilities`** — `id` (e.g. `desk_utilisation_measurement`), `name`, `description`, `status` (`available` | `planned` | `experimental`), `version`, `inputs_required` (jsonb), `outputs_provided` (jsonb), `owning_module` (text — which AWIP project provides it; null for `planned`)
- **`capability_connectors`** — what data sources each capability depends on
- **`capability_events`** — append-only log of every manifest change (registered, status changed, version bumped, deprecated). The second event stream the v2 Control Plane subscribes to.

Seeded with ~10–15 plausible capabilities, mostly `planned`. Meant to be wrong on day one and evolve.

### 3. Contract endpoints (Supabase Edge Functions)

All endpoints are **stateless and idempotent** — same input, same effect, safe to replay. This is non-negotiable; it's what lets a future Control Plane drive Core without coordination.

- `GET /capabilities` — returns the manifest, filterable by status. Used by Discovery AI during drafting and by future modules at registration time.
- `POST /okr/ingest` — Discovery AI submits a draft OKR tree. Idempotency key required. Validates structure, checks `required_capabilities` against the manifest, returns persisted IDs + warnings.
- `POST /okr/{id}/spawn` — spawn a sub-OKR with mandatory `spawned_from_reason`.
- `POST /okr/{id}/supersede` — replace a node, recording reason.
- `GET /okr/tree?tenant_id=...` — fetch full tree, including superseded nodes (filterable).
- `POST /capabilities/register` — stub for v1. Defines the contract future module projects will use to register. Writes to `capabilities` + emits a `capability_events` row.

**No business logic about "who acts when" lives in Core.** Core records intent (OKRs) and capability (manifest). Routing decisions stay outside — they belong to the v2 Control Plane.

All endpoints auth-gated. Service tokens for cross-project calls; operator JWT for the UI.

### 4. Operator view (read-only web UI)

For us, not clients. Pages:

- **Tenants list** — engagements, OKR node counts, last activity.
- **OKR tree view** — collapsible tree per tenant. Node shows status, version, `created_by`, `spawned_from_reason`. Superseded nodes dimmed but visible. Click a KR to see measurement spec + required capabilities.
- **Capability manifest** — table of all capabilities, status, owning module, and which OKRs across all tenants reference them. Demand signal for what to build next.
- **Event log** — chronological feed combining `okr_node_events` and `capability_events`. The audit trail and a preview of what the Control Plane will consume.

No editing, no agent actions, no client-facing surface.

### 5. Auth + tenancy

- Supabase Auth, email/password, single `operator` role for now.
- RLS on every table scoped by `tenant_id`; operators currently see everything.
- Cross-project calls (Discovery AI → Core) use service tokens stored as secrets on the calling project.

---

## Part B — Discovery AI follow-up

Small, scoped change in the existing Discovery AI project (separate Lovable project — handled as a follow-up task there, not part of this build):

1. Call Core's `GET /capabilities` during KR drafting. Constrain to `available` or tag KRs as future hooks.
2. POST approved drafts to `/okr/ingest` with an idempotency key. Surface validation warnings in the Discovery AI UI.
3. Store Core's service token as a secret.

No schema changes in Discovery AI; the OKR tree lives in Core.

---

## Orchestration: where it lives, where it's going

| Concern | v1 | v2 |
|---|---|---|
| Routing (which module acts on which OKR) | Hardcoded in Core / done by humans | Control Plane subscribes to `okr_node_events`, consults manifest, dispatches |
| Scheduling (cadence-driven measurement) | None — no acting modules yet | Control Plane cron, reading KR cadences |
| Module lifecycle (register/deprecate) | `POST /capabilities/register` writes to manifest | Control Plane reacts to `capability_events`, notifies waiting OKRs |
| Arbitration (two modules claim same capability) | N/A — only one module set | Control Plane uses version + tenant overrides |
| Observability (cross-module action audit) | Operator view event log | Control Plane aggregates module action logs |

The four design rules in v1 that make v2's Control Plane a clean addition:
1. Every OKR mutation emits an `okr_node_events` row.
2. Every manifest change emits a `capability_events` row.
3. All contract endpoints are stateless and idempotent (idempotency key on writes).
4. No "who acts when" logic in Core.

## What we explicitly defer

- **Control Plane project** — v2, when first acting module joins
- Agents (Goose, multi-agent orchestration) — own future projects
- CDPs (Documents, Leases, etc.) — each its own future project
- Connectors to client systems — own projects
- Client-facing UI / iOS PWA — own project
- Writes back into client systems
- Self-serve OKR authoring by clients
- Real-time KR scoring against live data
- Per-action provenance (audit at OKR-mutation level only for now)

## Technical notes

- **Stack**: Vite + React + TypeScript + Tailwind + shadcn/ui, Lovable Cloud for DB / auth / edge functions.
- **DB**: Postgres with RLS. Tree queries via recursive CTE.
- **Idempotency**: writes accept an `Idempotency-Key` header; Core stores recent keys per tenant and returns the original response on replay.
- **Manifest seeding**: a migration seeds initial `capabilities`.
- **Cross-project comms**: HTTPS only, service tokens. No project reaches into another's DB.
- **No external connectors needed for v1.**

## Success criteria for v1

1. Discovery AI can query `/capabilities` and POST a draft OKR tree, getting back IDs + validation warnings. Replaying the POST with the same idempotency key returns the same result without duplicates.
2. Spawning a sub-OKR works and shows up in the tree view with the spawn reason.
3. Superseding preserves history; event log shows the full evolution.
4. `capability_events` and `okr_node_events` together form a complete, replayable audit stream.
5. Operator view shows which OKRs reference which capabilities — demand signal for what to build next.
6. We can run a synthetic engagement end-to-end through Discovery AI → Core and have a coherent, auditable OKR tree.

When we hit those, the next conversation is "which `planned` capability do we promote to `available` first" — and that becomes the **third** Lovable project, built alongside the **fourth**: the Control Plane.
