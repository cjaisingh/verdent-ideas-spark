# AWIP v1 — The OKR Substrate (Core)

## What this is

AWIP is built as **a constellation of Lovable projects**, not one monolith. Each module (CDP, agent, connector) will be its own project, registering itself with Core via a shared contract.

- **AWIP Core** (this project) — OKR tree, capability manifest, operator view, contract endpoints. The spine every future module hangs off.
- **Discovery AI** (separate project) — queries Core during OKR drafting, hands off the finished tree to Core via `POST /okr/ingest`.
- **Control Plane** — currently embedded at `/control-plane` in this project. Read-only consumer of the event streams + demand aggregate. May move to its own project once the first acting module ships.

## Status

v1 success criteria are met end-to-end. A synthetic engagement has been driven through ingest → spawn → supersede → idempotent replay; the operator view, demand board, and event feed all reflect it correctly.

## Part A — AWIP Core (this project)

### Data model

- **`tenants`** — one per client engagement
- **`okr_nodes`** — versioned tree. `parent_id`, `kind` (`objective` | `key_result`), `status` (`draft` | `active` | `superseded` | `achieved` | `abandoned`), `version`, `superseded_by`, `spawned_from_reason`, `created_by` (`discovery_ai` | `awip` | `human`)
- **`okr_measurements`** — for KR nodes: `metric_name`, `baseline`, `target`, `unit`, `cadence`, `attribution_rules`, `data_sources`, `required_capabilities`
- **`okr_node_events`** — append-only log
- **`capabilities`** — `id`, `name`, `description`, `status` (`available` | `planned` | `experimental`), `version`, `inputs_required`, `outputs_provided`, `owning_module`
- **`capability_connectors`** — connector dependencies per capability
- **`capability_events`** — append-only log
- **`idempotency_keys`** — scope + key + cached response
- **`api_call_logs`** — every contract call (route, status, duration, actor, idempotency replay flag)
- **`user_roles`** — operator / admin via `has_role()` security-definer function

Sub-OKRs spawn by inserting with `parent_id`. Superseding sets old `status='superseded'` + `superseded_by`. Nothing is hard-deleted.

### Contract endpoints (single edge function `awip-api`)

All stateless and idempotent. Auth: operator JWT or `x-awip-service-token`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/capabilities` | Optional `?status=` |
| `POST` | `/capabilities/register` | Upsert + emit `registered` |
| `POST` | `/okr/ingest` | `Idempotency-Key` required |
| `POST` | `/okr/:id/spawn` | `spawned_from_reason` mandatory |
| `POST` | `/okr/:id/supersede` | Preserves history |
| `GET` | `/okr/tree?tenant_id=…` | Includes superseded |
| `GET` | `/events/recent` | `limit`, `since`, `tenant_id` |
| `GET` | `/capabilities/demand` | Ranked aggregate; surfaces unknown capabilities |
| `GET` | `/capabilities/:id/demand-detail` | Capability + KRs + tenants |

Every call logs to `api_call_logs`.

### Operator UI

- **Tenants** — list + detail with OKR tree (status, version, `created_by`, `spawned_from_reason`; superseded dimmed)
- **Capabilities** — manifest table
- **Events** — chronological log
- **API logs** — filterable by route, with idempotency-replay badge
- **Control Plane** — tabbed:
  - **Demand board** — capabilities ranked by active KRs / tenants. Filters: tenant, status, min active KRs. Sortable columns. Click → capability detail.
  - **Live event feed** — 5s polling with `since` cursor, source filter (okr / capability / all), colored rails per source, freshness flash on new rows.
- **Capability detail** (`/capabilities/:id`) — header + stats + tenants driving demand (linked) + KRs requiring it (active first, then superseded)

## Part B — Discovery AI follow-up (separate project)

1. Call `GET /capabilities` during drafting; constrain to `available` or tag as future hooks.
2. POST approved drafts to `/okr/ingest` with an idempotency key. Surface validation warnings.
3. Store Core's service token as a project secret.

## Orchestration: where it lives, where it's going

| Concern | Today | Future |
|---|---|---|
| Routing | Hardcoded / human | Control Plane subscribes to `okr_node_events`, consults manifest, dispatches |
| Scheduling | None | Control Plane cron, reading KR cadences |
| Module lifecycle | `POST /capabilities/register` | Control Plane reacts to `capability_events`, notifies waiting OKRs |
| Arbitration | N/A | Control Plane uses version + tenant overrides |
| Observability | Operator event log | Control Plane aggregates module action logs |

The four design rules that keep the future Control Plane a clean addition:

1. Every OKR mutation emits an `okr_node_events` row.
2. Every manifest change emits a `capability_events` row.
3. All write endpoints are idempotent.
4. No "who acts when" logic in Core.

## Explicitly deferred

- Acting modules (agents, CDPs, connectors) — own projects
- Client-facing UI / iOS PWA — own project
- Writes back into client systems
- Self-serve OKR authoring by clients
- Real-time KR scoring against live data
- Per-action provenance (audit at OKR-mutation level only for now)

## v1 success criteria — status

- ✅ Discovery AI can query `/capabilities` and POST a draft tree, getting back IDs + warnings. Replay with same idempotency key returns same result without duplicates.
- ✅ Spawning a sub-OKR works and shows in the tree with the spawn reason.
- ✅ Superseding preserves history; event log shows the full evolution.
- ✅ `capability_events` + `okr_node_events` form a complete replayable stream (`/events/recent`).
- ✅ Operator view shows which OKRs reference which capabilities (demand board + capability detail).
- ✅ Synthetic engagement run end-to-end (Acme Coworking + Verify Discovery tenants).

## Next decision

Promote the first capability to `available`. `desk_utilisation_measurement` has the strongest demand signal (2 tenants, 1 active KR after the sensor-ingest supersede). Either build it as the first module project, or seed more tenants first to make the ranking meaningful.
