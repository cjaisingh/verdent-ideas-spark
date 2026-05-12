## Goal

Promote the existing icon-only re-probe on `/connections` into a visible **Test connection** button on every integration row, and extend coverage so direct-API connectors (Perplexity, Firecrawl, ElevenLabs, Aikido) can also be tested — not just gateway ones.

## Scope

- Edit `supabase/functions/connections-inventory/index.ts` to add a per-connector probe map for direct-API connectors and re-use the gateway `verify_credentials` path for the rest.
- Edit `src/pages/Connections.tsx` to render a labelled `Test` button on every linked row, with success/failure toast and inline last-result chip.
- Persist the last probe result to a new `connection_test_results` table so the chip survives a page reload (operator-only RLS, realtime off).
- Doc: `docs/connections.md` (new) + CHANGELOG entry.

Out of scope: testing **unlinked** connectors (no secret to test with), scope/permission discovery beyond what each provider's cheapest call returns, alerting on failure, scheduled re-tests.

## Probe map

| Connector | Probe |
|---|---|
| All gateway connectors | `POST https://connector-gateway.lovable.dev/api/v1/verify_credentials` (already wired) |
| `perplexity` | `POST https://api.perplexity.ai/chat/completions` with 1-token `sonar-small` request |
| `firecrawl` | `GET https://api.firecrawl.dev/v1/team/credit-usage` (cheap, no scrape spend) |
| `elevenlabs` | `GET https://api.elevenlabs.io/v1/user` |
| `aikido` | `GET https://app.aikido.dev/api/public/v1/issues_count` |

Each direct-API probe returns `{ outcome: "verified" | "failed", latency_ms, error?, scope_hint? }` where `scope_hint` is whatever permission detail the call returns (e.g. Perplexity tier, Firecrawl remaining credits, ElevenLabs subscription tier). Surfaced under the row.

## Persistence

```sql
create table public.connection_test_results (
  env_var_name text primary key,
  connector_id text not null,
  outcome text not null check (outcome in ('verified','skipped','failed','unknown')),
  latency_ms integer,
  error text,
  scope_hint jsonb,
  tested_at timestamptz not null default now(),
  tested_by uuid references auth.users(id)
);
alter table public.connection_test_results enable row level security;
create policy "operator read" on public.connection_test_results
  for select to authenticated using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
-- writes happen via the edge function with service role; no insert/update policy needed.
```

`connections-inventory` writes one row per probe (upsert by `env_var_name`). The list endpoint joins `connection_test_results` so each row in the page renders with its last-known outcome on first paint.

## UI

Per row (linked tab and needs-action tab):

```
[Plug] Telegram                          [Verified · 120ms · 2m ago] [Test connection]
       telegram · TELEGRAM_API_KEY · gateway
```

- Button: `<Button size="sm" variant="outline">Test connection</Button>`, spinner while running.
- Result toast on click with outcome + latency + first 80 chars of error.
- For `failed`, the row's status pill flips to amber **Reconnect** with a link to Cloud → Connectors.
- For direct-API connectors with `scope_hint`, render a one-line `text-xs text-muted-foreground` summary under the row (e.g. "Plan: standard · 4,800 credits left").

## Verification

- Build passes.
- `/connections` shows a Test button on every linked row.
- Click on Telegram → toast shows verified + ms; result persists across refresh.
- Click on a direct-API connector if linked → returns verified with scope_hint, or failed with provider error.
- Logger Validation workflow stays green.
