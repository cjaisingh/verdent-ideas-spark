## Goal

A single operator-only page at `/connections` that answers three questions at a glance:

1. What is **linked** to this project right now?
2. What is **available** in the workspace but not yet linked?
3. What needs my **action** (not linked, missing scopes, expired, or no access)?

No new backend tables, no new edge functions. Pure read-only surface backed by the workspace's connector inventory + a tiny edge function that fans out to the existing connector verify-credentials endpoint.

## Scope

- New page: `src/pages/Connections.tsx` (route `/connections`, gated by operator role like every other admin page).
- New sidebar entry under the Admin group.
- New edge function: `supabase/functions/connections-inventory/index.ts` — operator JWT only, `withLogger`-wrapped. Returns the connector inventory (calls the same Lovable API used by the workspace UI) plus a per-connection verify-credentials probe (latency + outcome).
- Doc: `docs/connections.md`. Add to README index + CHANGELOG.

Out of scope: linking/unlinking from the UI (Lovable's connector dialog handles that — page links out to it), MCP/chat connectors, secret rotation UI, credential editing.

## Page layout

```text
/connections
┌──────────────────────────────────────────────────────────────┐
│ Connections                              [Refresh] [Open Cloud→Connectors] │
│ N linked · M available · K need action                       │
├──────────────────────────────────────────────────────────────┤
│ Tabs: [Needs action (K)] [Linked (N)] [Available (M)] [All]  │
├──────────────────────────────────────────────────────────────┤
│ ▸ Telegram         linked   gateway   verified  120ms        │
│   Chris's Telegram · used by: gemini-tts? telegram-bot?      │
│   [Open in Cloud] [Test credentials] [Unlink…]               │
│                                                              │
│ ▸ Gmail            available  gateway  —                     │
│   Chris's Gmail · not linked                                 │
│   [Link to project]                                          │
│                                                              │
│ ▸ Perplexity       available  direct API  —                  │
│   ...                                                        │
└──────────────────────────────────────────────────────────────┘
```

Each row shows: connector name, status pill (linked / available / needs-action / no-access), transport pill (gateway / direct API), last verify outcome + latency, connection display name. Expanding a row shows: connection_id, connector_id, scopes (when gateway returns them), and the matching env-var name (e.g. `TELEGRAM_API_KEY`).

Filter chips: status, transport, has-access. Search box over connector + connection name.

## Status derivation

| State           | Rule                                                                 | Pill                |
|-----------------|----------------------------------------------------------------------|---------------------|
| Linked, healthy | `linked && verify.outcome in {verified, skipped}`                    | green "Linked"      |
| Needs action    | `linked && verify.outcome === 'failed'`                              | amber "Reconnect"   |
| Available       | `!linked && has_access && linkable`                                  | grey "Available"    |
| No access       | `!has_access`                                                        | grey "No access"    |
| Blocked         | `!linkable` (e.g. workspace-only connector)                          | grey "Workspace only" |

The amber "Reconnect" row links to Lovable Cloud → Connectors with the relevant connection pre-selected (we just open the standard connectors panel — no inline reconnect, since we can't drive `standard_connectors--reconnect` from the runtime app).

## Edge function: `connections-inventory`

- Auth: operator JWT only (`requireOperator` helper). No service-token path.
- Behaviour:
  1. Calls the same workspace listing endpoint Lovable uses for the connector picker (the function runs server-side with the project's `LOVABLE_API_KEY`, so it sees everything `list_connections` would surface for the linked workspace).
  2. For each `linked && uses_gateway` connection, fans out to `POST https://connector-gateway.lovable.dev/api/v1/verify_credentials` with `Authorization: Bearer ${LOVABLE_API_KEY}` and `X-Connection-Api-Key: ${<CONNECTOR>_API_KEY}` from `Deno.env`. Cache the result for 60 s in-memory to keep refresh cheap.
  3. Returns:
     ```json
     {
       "linked": [{ "connector_id", "connection_id", "name", "uses_gateway", "verify": { "outcome", "latency_ms", "error?" }, "env_var_name" }],
       "available": [{ "connector_id", "connection_id", "name", "uses_gateway", "linkable", "has_access" }],
       "fetched_at": "<iso>"
     }
     ```
- Wrapped with `withLogger`. Writes nothing to the DB.

If the workspace listing endpoint is not reachable from an edge function (the curl-the-Lovable-API path is the one risky assumption), the function falls back to: returning only the **linked** half by reading the connector env vars present in `Deno.env` (`*_API_KEY` matching the known connector list). The "Available" tab then shows an empty state with a link to Cloud → Connectors. We'll learn which path works on the first deploy.

## Frontend file plan

- `src/pages/Connections.tsx` — page shell, fetch via `supabase.functions.invoke('connections-inventory')`, tabs, search, row rendering.
- `src/components/connections/ConnectionRow.tsx` — single row + expand panel.
- `src/components/connections/StatusPill.tsx`, `TransportPill.tsx` — small visual atoms.
- `src/components/connections/VerifyButton.tsx` — re-runs verify for one connection (calls a `?probe=<connection_id>` query on the same edge function).
- Sidebar: add "Connections" link in `src/components/AppSidebar.tsx` under the existing Admin group, behind operator role.
- Route registration in `src/App.tsx`.

## Verification

- Build passes.
- `/connections` loads as operator: shows ≥1 linked row (Telegram) and N available rows.
- Telegram verify probe returns `verified` (or `skipped`) with a latency number.
- Non-operator user gets redirected by `RequireAuth` like every other admin page.
- Logger Validation workflow stays green (the new function is `withLogger`-wrapped).

## Memory + docs

- Add `mem://features/connections-page` describing route, edge function, and the status derivation table.
- `docs/connections.md` mirrors the page contract for AWIP Reviews.
- Update `README.md` admin index + `CHANGELOG.md`.
