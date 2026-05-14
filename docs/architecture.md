# AWIP Core — Architecture Overview

This doc explains how AWIP Core is put together: the data model, the two event streams that fall out of it, and how the operator UI and Control Plane consume those streams. The companion file [api.md](./api.md) is the endpoint reference.

## Mental model in one paragraph

Core is a **substrate**, not a brain. It records two kinds of facts: *what we said we'd do* (OKR trees) and *what we can do* (capability manifest). Every change to either fact emits an immutable event. Everything else in the AWIP constellation — Discovery AI, the Control Plane, future agents and connectors — is a **consumer** of those facts and event streams. Core has no opinion about who acts when.

```
                                          ┌──────────────────────┐
                                          │   Discovery AI       │
                                          │   (separate project) │
                                          └──────────┬───────────┘
                                                     │ POST /okr/ingest
                                                     │ GET  /capabilities
                                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                         AWIP Core                                │
│                                                                  │
│   tenants ──┐                                                    │
│             ▼                                                    │
│   okr_nodes ── okr_measurements        capabilities              │
│       │                                    │                     │
│       ▼                                    ▼                     │
│   okr_node_events  ─────┐        ┌──── capability_events         │
│                         ▼        ▼                               │
│                       (merged event stream)                      │
└────────────────┬───────────────────────────┬─────────────────────┘
                 │                           │
                 │ GET /events/recent        │ GET /capabilities/demand
                 │ GET /capabilities/demand  │ GET /capabilities/:id/demand-detail
                 ▼                           ▼
        ┌────────────────┐         ┌────────────────────┐
        │ Operator UI    │         │ Control Plane      │
        │ (this project) │         │ (embedded today,   │
        │                │         │  separate later)   │
        └────────────────┘         └────────────────────┘
```

## The two halves of the data model

### 1. The OKR tree — *what we said we'd do*

A **tenant** has many **OKR nodes** arranged in a tree (`parent_id` is nullable). Each node is either an `objective` or a `key_result`. Key results carry a separate **measurement** row (`okr_measurements`) describing the metric, baseline, target, cadence, and the `required_capabilities[]` they depend on.

The tree is **versioned, not editable**. Two operations evolve it:

- **Spawn** — insert a new child with `parent_id` set and a mandatory `spawned_from_reason`. Used when reality reveals a sub-goal that wasn't in the original draft.
- **Supersede** — insert a v+1 successor; mark the old node `status = 'superseded'` with `superseded_by` pointing at the new id. The old node stays in the tree, dimmed in the UI. Nothing is hard-deleted.

This is what lets the operator UI (and any future replay tooling) reconstruct *why* the tree looks the way it does today — not just what it says.

### 2. The capability manifest — *what we can do*

A **capability** is a discrete ability the AWIP constellation can offer (`desk_utilisation_measurement`, `churn_prediction`, `nps_collection`, …). Each row carries a `status` (`available` | `planned` | `experimental`) and an `owning_module` (which AWIP project provides it; null while `planned`).

KRs reference capabilities by id in `okr_measurements.required_capabilities`. Crucially, **a KR is allowed to reference a capability that doesn't exist in the manifest yet.** Those show up in the demand board with status `unknown` — that's the explicit signal of "real demand for something nobody's built or even registered."

`capability_connectors` records which external data sources each capability depends on. Not exercised heavily in v1.

### 3. Cross-cutting tables

- **`idempotency_keys`** — `(scope, key)` → cached response. Today only `okr_ingest` writes here; replays return the original body.
- **`api_call_logs`** — every contract call: route, method, actor, idempotency-replay flag, status, duration, request/response summaries. Powers `/api-logs`.
- **`user_roles`** — operator/admin via the security-definer `has_role(uid, role)`. Used in every RLS policy.

## The two event streams

Two append-only tables. Together they're a complete, replayable history.

### `okr_node_events`

Emitted by every OKR mutation. Payload is event-specific.

| `event_type` | When | `payload` |
|---|---|---|
| `ingested` | A node was created via `POST /okr/ingest` | `{ client_id }` |
| `spawned` | Sub-OKR created via `POST /okr/:id/spawn` | `{ parent_id, reason }` |
| `superseded` | Old node marked superseded by `/supersede` | `{ superseded_by, reason }` |
| `created` | New v+1 node from `/supersede` | `{ supersedes }` |

Always includes `tenant_id`, `okr_node_id`, `actor` (`service:discovery_ai`, `user:<uid>`, or `human`), `created_at`.

### `capability_events`

Emitted by every manifest mutation.

| `event_type` | When | `payload` |
|---|---|---|
| `registered` | `POST /capabilities/register` upserts a capability | full request body |

Future events (`status_changed`, `version_bumped`, `deprecated`) are anticipated but not yet wired.

### Why two streams, merged at read time

Keeping them physically separate keeps each table's schema honest to its domain. The merge happens at read time in **`GET /events/recent`**, which interleaves both tables, sorted desc by `created_at`, with a `source: "okr" | "capability"` discriminator on every row. Consumers don't need to know about the split.

## How the operator UI consumes the model

The operator UI is the human window onto Core. **Read-only**, no agent actions, no client surface. Pages:

| Route | Reads | Purpose |
|---|---|---|
| `/tenants` | `tenants`, count joins on `okr_nodes` | Engagement list |
| `/tenants/:id` | `okr_nodes` + `okr_measurements` (recursive) | Tree view; superseded dimmed; click KR to see metric + required capabilities |
| `/capabilities` | `capabilities` | Manifest table |
| `/capabilities/:id` | `GET /capabilities/:id/demand-detail` | Capability + tenants driving demand + KRs requiring it |
| `/events` | `okr_node_events` + `capability_events` | Direct DB read of both streams |
| `/api-logs` | `api_call_logs` | Filterable; idempotency-replay badge |
| `/control-plane` | See below | Operator-as-Control-Plane preview |

Auth: operator JWT, RLS-enforced. The UI uses the JS Supabase client for direct reads on tables it has policies for, and the edge function for anything that involves cross-table aggregation (demand, demand-detail).

## How the Control Plane consumes the model

The Control Plane is a **read-only consumer of the contract**. It doesn't touch the database. It only calls three endpoints:

1. **`GET /capabilities/demand`** — ranked list of capabilities (active KRs, tenant count). Includes `unknown` capabilities. Drives the **Demand board** tab.
2. **`GET /capabilities/:id/demand-detail`** — drill-down (tenants + KRs) when a row is clicked.
3. **`GET /events/recent?since=…`** — polled every 5s with a `since` cursor. Drives the **Live event feed** tab.

```
┌──────────────────────────────────────────────────────┐
│ Control Plane (browser, polls every 5s)              │
│                                                      │
│  ┌──────────────────┐    ┌──────────────────────┐    │
│  │ Demand board     │    │ Live event feed      │    │
│  │  - filters       │    │  - source filter     │    │
│  │  - sort          │    │  - since cursor      │    │
│  │  - row → detail  │    │  - flash on new      │    │
│  └────────┬─────────┘    └──────────┬───────────┘    │
│           │                         │                │
│           ▼                         ▼                │
│  GET /capabilities/demand    GET /events/recent      │
│  GET /capabilities/:id/demand-detail                 │
└──────────────────────────────────────────────────────┘
```

The Control Plane lives at `/control-plane` in this project today. It's deliberately built **only against the HTTP contract** (no Supabase JS client, no direct table reads) so it can be lifted into its own Lovable project verbatim when the first acting module ships. At that point its role expands from observation to dispatch:

> Future Control Plane (post-v1): subscribes to `okr_node_events`, consults the manifest, dispatches work to module projects, aggregates their action logs back into a unified audit view. Today's polling feed is the placeholder for the same loop.

## The four invariants

These are the rules Core enforces so the future Control Plane is a clean addition, not a rewrite:

1. **Every OKR mutation emits an `okr_node_events` row.**
2. **Every manifest change emits a `capability_events` row.**
3. **All write endpoints are idempotent.** Same `Idempotency-Key` returns the original response.
4. **No "who acts when" logic in Core.** Routing belongs to consumers.

If any future change to Core breaks one of these, the Control Plane breaks too. Treat them as load-bearing.

## What lives where (project boundaries)

| Concern | Project | Talks to Core via |
|---|---|---|
| OKR drafting (LLM-assisted) | Discovery AI | `GET /capabilities`, `POST /okr/ingest` (service token) |
| OKR storage + manifest + events | **AWIP Core** (this) | — |
| Operator visibility | **AWIP Core** (this) | Direct DB + edge function (operator JWT) |
| Cross-module observation / dispatch | Control Plane (embedded; will move) | `GET /events/recent`, `GET /capabilities/demand`, `GET /capabilities/:id/demand-detail` |
| Acting modules (CDPs, agents, connectors) | Future projects | `POST /capabilities/register` + their own logic |

No project reaches into another's database. Everything is HTTPS + service tokens. That's the whole architecture.

## Sentinel triage activity (notification stream)

Sentinel findings are grouped into `discussion_actions` via the junction table **`discussion_action_findings`** (`action_id`, `finding_id`, `linked_by`, `linked_by_label`, `note`). Operator/admin RLS, realtime, and a unique `(action_id, finding_id)` constraint so the same finding can't be linked twice.

When a row is inserted, trigger **`trg_log_sentinel_triage_group`** counts the action's links: at the 1→2 transition it writes a `group_formed` event into **`sentinel_triage_activity`**; every subsequent insert writes `group_grew`. Each activity row carries `action_id`, `action_short_num`, `action_title`, `event_kind`, `finding_count`, `finding_ids[]`, `triggered_by`, `triggered_by_label`, plus a per-operator `acknowledged_by uuid[]` so notifications dismiss independently per user.

Three SECURITY DEFINER functions back the UI:

- `sentinel_triage_unacked_count()` → integer the sidebar badge polls.
- `acknowledge_triage_activity(_id)` → marks one row read for the caller.
- `acknowledge_all_triage_activity()` → marks every unacked row read.

Surfaces:

- **`LinkFindingButton`** on the Sentinel status strip lets operators search open `discussion_actions` by `#short_num` or title and attach the current finding (with optional note). This is the only write path; insertion fires the trigger.
- **Sidebar badge** on the Morning Review nav row (amber count of unacked rows for the current operator), realtime-subscribed via a unique-per-mount channel name.
- **`SentinelTriageActivityPanel`** on `/morning-review` shows the feed + per-row and bulk acknowledge controls.

There is no external delivery (no email/Telegram/webhook) — in-app only. The activity stream is purely a notification surface; it does not change action state, status, or risk.

## See also

- [api.md](./api.md) — endpoint reference with examples
- [`../.lovable/plan.md`](../.lovable/plan.md) — v1 plan + status

