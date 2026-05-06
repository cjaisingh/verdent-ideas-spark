# AWIP Core

Operator console + contract API for the AWIP constellation. Owns the OKR tree, the capability manifest, and the event streams every other AWIP project subscribes to.

See [.lovable/plan.md](.lovable/plan.md) for the full v1 plan and current status.

## What's in this project

- **Database** (Lovable Cloud / Postgres + RLS)
  - `tenants`, `okr_nodes`, `okr_measurements`, `okr_node_events`
  - `capabilities`, `capability_connectors`, `capability_events`
  - `idempotency_keys`, `api_call_logs`
  - `user_roles` (operator / admin via `has_role()`)
- **Contract API** — single edge function `awip-api` (auth via operator JWT or `x-awip-service-token`)
- **Operator UI** — Tenants, Capabilities, Events, API logs, **Control Plane** (demand board + live feed), Capability detail

## Contract endpoints

All endpoints accept either an operator JWT (`Authorization: Bearer …`) or the cross-project service token (`x-awip-service-token: …`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/capabilities` | Manifest, optional `?status=` filter |
| `POST` | `/capabilities/register` | Module self-registration (upsert + emit `registered`) |
| `POST` | `/okr/ingest` | Ingest a draft OKR tree. Requires `Idempotency-Key` header for safe replay |
| `POST` | `/okr/:id/spawn` | Spawn a sub-OKR with mandatory `spawned_from_reason` |
| `POST` | `/okr/:id/supersede` | Replace a node, preserving history |
| `GET` | `/okr/tree?tenant_id=…` | Full tree (incl. superseded) |
| `GET` | `/events/recent` | Merged OKR + capability event stream. Params: `limit`, `since`, `tenant_id` |
| `GET` | `/capabilities/demand` | Capabilities ranked by `active_kr_count`, then `tenant_count`. Surfaces `unknown` capabilities referenced by KRs but never registered |
| `GET` | `/capabilities/:id/demand-detail` | Capability + driving KRs + tenants |

Every call is logged to `api_call_logs` (route, status, duration, actor, idempotency replay flag).

## Design rules (don't break these)

1. Every OKR mutation emits an `okr_node_events` row.
2. Every manifest change emits a `capability_events` row.
3. All write endpoints are idempotent — same `Idempotency-Key` returns the original response.
4. No "who acts when" logic in Core. Routing belongs in the Control Plane.

## Development

```bash
bun install
bun run dev
```

Database changes go through migrations only — never edit `src/integrations/supabase/types.ts`. Edge function code lives in `supabase/functions/awip-api/index.ts` and deploys automatically on save.

## Related projects

- **Discovery AI** (separate Lovable project) — calls `GET /capabilities` during drafting and `POST /okr/ingest` to hand off finished trees
- **Control Plane** — currently embedded in this project at `/control-plane`. Will likely move to its own Lovable project when the first acting module ships
