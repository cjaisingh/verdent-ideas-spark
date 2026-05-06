# AWIP Core — API Reference

Single edge function: **`awip-api`**.

**Base URL**

```
https://<project-ref>.functions.supabase.co/awip-api
```

In this project, prefer the env var:

```ts
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;
```

---

## Authentication

Every endpoint requires **one** of:

1. **Operator JWT** — for the operator UI.
   ```
   Authorization: Bearer <supabase-access-token>
   ```
   The user must have the `operator` or `admin` role in `user_roles`.

2. **Service token** — for cross-project (server-to-server) calls.
   ```
   x-awip-service-token: <AWIP_SERVICE_TOKEN>
   ```
   The token is stored as a Supabase secret on Core and on the calling project.

If the service-token header is present and matches, the call is authorized as `service:discovery_ai`. Otherwise the JWT path is taken. Missing/invalid → `401 { "error": "missing auth" | "invalid jwt" | "not operator" }`.

CORS: all origins, methods `GET, POST, OPTIONS`, headers include `idempotency-key`.

---

## Idempotency

Write endpoints accept:

```
Idempotency-Key: <opaque-string>
```

Currently honored on **`POST /okr/ingest`**. Replays with the same key return the original cached response from `idempotency_keys`. Replays after the first call show up in `api_call_logs` with `idempotent_replay = true`.

---

## Logging

Every request appends a row to `api_call_logs`:
`route, method, actor, idempotency_key, idempotent_replay, status_code, duration_ms, tenant_id, request_summary, response_summary, error`.

Visible in the operator UI at **/api-logs**.

---

## Endpoints

### `GET /capabilities`

List the capability manifest.

**Query params**

| param | type | notes |
|---|---|---|
| `status` | string | optional filter: `available` \| `planned` \| `experimental` |

**Response — `200`**

```json
{
  "capabilities": [
    {
      "id": "desk_utilisation_measurement",
      "name": "Desk utilisation measurement",
      "description": null,
      "status": "planned",
      "version": "0.1.0",
      "inputs_required": [],
      "outputs_provided": [],
      "owning_module": null,
      "created_at": "2026-05-05T12:00:00.000Z",
      "updated_at": "2026-05-05T12:00:00.000Z"
    }
  ]
}
```

---

### `POST /capabilities/register`

Upsert a capability and emit a `capability_events.registered` event. Stub for v1; intended for module projects to self-register.

**Body**

```json
{
  "id": "desk_utilisation_measurement",
  "name": "Desk utilisation measurement",
  "description": "Hourly occupancy per desk",
  "status": "available",
  "version": "0.2.0",
  "inputs_required": [{ "kind": "sensor_feed" }],
  "outputs_provided": [{ "metric": "desk_occupancy_pct" }],
  "owning_module": "occupancy_module"
}
```

Required: `id`, `name`, `status`. Others optional.

**Response — `200`**

```json
{ "ok": true, "id": "desk_utilisation_measurement" }
```

**Errors**: `400` missing field, `500` db error.

---

### `POST /okr/ingest`

Ingest a draft OKR tree for a tenant. Idempotent.

**Headers**

```
Idempotency-Key: discovery-ai/2026-05-05/acme-001
```

**Body**

```json
{
  "tenant_slug": "acme-coworking",
  "tenant_name": "Acme Coworking",
  "nodes": [
    {
      "client_id": "obj-1",
      "kind": "objective",
      "title": "Reduce member churn"
    },
    {
      "client_id": "kr-1",
      "parent_client_id": "obj-1",
      "kind": "key_result",
      "title": "Churn under 4% by Q3",
      "measurement": {
        "metric_name": "monthly_churn_pct",
        "baseline": 7.2,
        "target": 4,
        "unit": "%",
        "cadence": "monthly",
        "attribution_rules": {},
        "data_sources": [{ "kind": "billing" }],
        "required_capabilities": ["churn_prediction", "member_engagement_signals"]
      }
    }
  ]
}
```

`client_id` is caller-assigned and used to wire `parent_client_id` → real `parent_id` after insert.

**Response — `200`**

```json
{
  "ok": true,
  "tenant_id": "8f1d…",
  "created": [
    { "client_id": "obj-1", "id": "11111111-…" },
    { "client_id": "kr-1",  "id": "22222222-…" }
  ],
  "warnings": [
    "unknown capability: member_engagement_signals",
    "capability churn_prediction is planned (future hook)"
  ]
}
```

Replays with the same `Idempotency-Key` return the **same body**.

**Errors**: `400` missing `tenant_slug`/`nodes`, `500` db error.

---

### `POST /okr/:id/spawn`

Spawn a sub-OKR under an existing node.

**Body**

```json
{
  "kind": "key_result",
  "title": "Onboarding completion >80% in first 14 days",
  "description": "Sub-KR under the churn KR",
  "spawned_from_reason": "Discovered onboarding drop-off in week-1 cohort",
  "created_by": "human"
}
```

Required: `kind`, `title`, `spawned_from_reason`. `created_by` defaults to `human`.

**Response — `200`**

```json
{
  "ok": true,
  "node": {
    "id": "33333333-…",
    "tenant_id": "8f1d…",
    "parent_id": "22222222-…",
    "kind": "key_result",
    "title": "Onboarding completion >80% in first 14 days",
    "status": "draft",
    "version": 1,
    "spawned_from_reason": "Discovered onboarding drop-off in week-1 cohort",
    "created_by": "human",
    "created_at": "…"
  }
}
```

Emits `okr_node_events.spawned` with `{ parent_id, reason }`.

**Errors**: `400` missing field, `404` parent not found.

---

### `POST /okr/:id/supersede`

Replace a node with a v+1 successor. Old node becomes `superseded` with `superseded_by` pointing at the new id. Nothing is deleted.

**Body**

```json
{
  "title": "Peak-hour desk occupancy >70%",
  "description": "Replaces raw utilisation with peak-hour focus",
  "reason": "Average desk utilisation hides the only metric clients care about",
  "created_by": "human"
}
```

Required: `title`, `reason`.

**Response — `200`**

```json
{
  "ok": true,
  "node": { "id": "44444444-…", "version": 2, "status": "active", "…": "…" }
}
```

Emits two events: `superseded` on the old node, `created` on the new one.

**Errors**: `400` missing field, `404` node not found.

---

### `GET /okr/tree`

Full tree for a tenant, including superseded nodes.

**Query params**

| param | type | required |
|---|---|---|
| `tenant_id` | uuid | yes |

**Response — `200`**

```json
{
  "nodes": [
    {
      "id": "11111111-…",
      "tenant_id": "8f1d…",
      "parent_id": null,
      "kind": "objective",
      "title": "Reduce member churn",
      "status": "active",
      "version": 1,
      "superseded_by": null,
      "spawned_from_reason": null,
      "created_by": "discovery_ai",
      "created_at": "…",
      "updated_at": "…",
      "okr_measurements": []
    }
  ]
}
```

---

### `GET /events/recent`

Merged reverse-chronological stream of `okr_node_events` + `capability_events`. Designed for the Control Plane's polling feed.

**Query params**

| param | type | default | notes |
|---|---|---|---|
| `limit` | int | 100 | max 500 |
| `since` | ISO-8601 timestamp | — | exclusive lower bound on `created_at` |
| `tenant_id` | uuid | — | filter OKR events to this tenant (capability events are global) |

**Response — `200`**

```json
{
  "count": 2,
  "events": [
    {
      "id": "e1…",
      "source": "okr",
      "ref": "22222222-…",
      "tenant_id": "8f1d…",
      "event_type": "spawned",
      "payload": { "parent_id": "…", "reason": "…" },
      "actor": "service:discovery_ai",
      "created_at": "2026-05-05T20:19:29.421Z"
    },
    {
      "id": "e2…",
      "source": "capability",
      "ref": "desk_utilisation_measurement",
      "tenant_id": null,
      "event_type": "registered",
      "payload": { "…": "…" },
      "actor": "user:abc…",
      "created_at": "2026-05-05T19:57:14.230Z"
    }
  ]
}
```

**Polling pattern**

```ts
let since: string | null = null;
async function poll() {
  const url = new URL(`${FN}/events/recent`);
  if (since) url.searchParams.set("since", since);
  else url.searchParams.set("limit", "50");
  const r = await fetch(url, { headers: authHeaders });
  const { events } = await r.json();
  if (events.length) since = events[0].created_at;
  // events arrive newest-first; merge into UI list
}
```

---

### `GET /capabilities/demand`

Capability demand aggregate, ranked. Surfaces both registered capabilities and **unknown** capabilities referenced by KRs but never registered (status `unknown`) — the "build this next" signal.

**Response — `200`**

```json
{
  "demand": [
    {
      "id": "desk_utilisation_measurement",
      "name": "Desk utilisation measurement",
      "status": "planned",
      "owning_module": null,
      "tenant_ids": ["8f1d…", "a02c…"],
      "tenant_count": 2,
      "kr_count": 2,
      "active_kr_count": 1
    },
    {
      "id": "member_engagement_signals",
      "name": "member_engagement_signals",
      "status": "unknown",
      "owning_module": null,
      "tenant_ids": ["8f1d…"],
      "tenant_count": 1,
      "kr_count": 1,
      "active_kr_count": 1
    }
  ],
  "tenants": [
    { "id": "8f1d…", "slug": "acme-coworking", "name": "Acme Coworking" },
    { "id": "a02c…", "slug": "verify-discovery", "name": "Verify Discovery" }
  ]
}
```

Sorted by `active_kr_count` desc, then `tenant_count` desc, then `name` asc. Superseded KRs count toward `kr_count` but not `active_kr_count`.

---

### `GET /capabilities/:id/demand-detail`

Per-capability drill-down used by the operator's `/capabilities/:id` page.

**Response — `200`**

```json
{
  "capability": {
    "id": "desk_utilisation_measurement",
    "name": "Desk utilisation measurement",
    "status": "planned",
    "owning_module": null,
    "description": null
  },
  "tenants": [
    {
      "id": "8f1d…", "slug": "acme-coworking", "name": "Acme Coworking",
      "kr_count": 1, "active_kr_count": 1
    }
  ],
  "krs": [
    {
      "id": "22222222-…",
      "title": "Peak-hour desk occupancy >70%",
      "status": "active",
      "version": 2,
      "created_at": "…",
      "tenant": { "id": "8f1d…", "slug": "acme-coworking", "name": "Acme Coworking" },
      "parent_title": "Maximise desk yield",
      "measurement": {
        "metric_name": "peak_hour_occupancy_pct",
        "target": 70,
        "unit": "%",
        "cadence": "weekly"
      }
    }
  ]
}
```

KRs sort active-first, then by `created_at` desc. If the capability is unknown, `capability` falls back to `{ id, name: id, status: "unknown", owning_module: null }`.

---

## Common error shape

```json
{ "error": "human-readable message" }
```

| Status | Meaning |
|---|---|
| `400` | Validation — missing/invalid field |
| `401` | Auth — missing/invalid JWT, missing/wrong service token, or JWT user not an operator |
| `404` | Route not matched, or referenced resource (parent OKR, node) not found |
| `500` | Database error — message included |

---

## Quick recipes

### Operator JWT call (browser)

```ts
const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;
const r = await fetch(`${FN}/capabilities/demand`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

### Service-token call (cross-project)

```ts
const r = await fetch(`${CORE_BASE}/okr/ingest`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-awip-service-token": Deno.env.get("AWIP_SERVICE_TOKEN")!,
    "idempotency-key": `discovery-ai/${runId}`,
  },
  body: JSON.stringify(payload),
});
```

### Tail the live event feed

```ts
setInterval(async () => {
  const url = new URL(`${FN}/events/recent`);
  if (since) url.searchParams.set("since", since);
  const { events } = await (await fetch(url, { headers: auth })).json();
  if (events.length) { since = events[0].created_at; render(events); }
}, 5000);
```
