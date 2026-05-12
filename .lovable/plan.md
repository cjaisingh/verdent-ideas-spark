## What's actually broken

`connections-inventory` itself is fine — current direct curl returns 200, and `edge_request_logs` has zero 4xx/5xx rows for any function in the last 6 hours. The browser shows "Failed to fetch" on three calls between 16:58 and 17:01, which is the request being torn down before it left the network stack (CORS preflight, transient TLS, or page navigation). Those never reach the server, so no server log exists.

## Why I missed it

We already capture every server-side edge function call into `public.edge_request_logs` via the `withLogger` middleware, including `status`, `latency_ms`, `classified_error`, and `error_message`. Nothing watches that table. The Sentinel Agent runs every 15 minutes but its checks don't include edge function health, so 5xx spikes can sit silent until someone opens the page.

## Plan

Two pieces, both small.

### 1. Sentinel watch for edge-function errors

Extend `supabase/functions/sentinel-tick/index.ts` with a new module `edge_function_errors`:

- Window: last 30 minutes.
- Query `edge_request_logs` grouped by `function_name`, computing `error_rate = 5xx / total` and `error_count`.
- Emit a `sentinel_findings` row when:
  - `error_count >= 3` and `error_rate >= 0.2` (high), OR
  - any single function has `error_count >= 10` in the window (critical).
- Finding payload includes function name, count, top `classified_error`, sample `error_message`, last `request_id`, deep link to `/admin/edge-health`.
- High/critical findings already roll into the daily Morning Review and the existing alert webhook — no new plumbing.

### 2. Operator-facing edge function health panel

New page `/admin/edge-health` (linked from sidebar Admin section, next to Connections):

- Top: 24-hour summary table per function — total calls, error count, error rate, p95 latency, last error (timestamp + classified_error + 120-char message), pulled from `edge_request_logs`.
- Click a function → drawer with the 50 most recent failing rows (timestamp, status, request_id, classified_error, error_message, user_id_hash).
- Auto-refresh every 60s.
- Operator-only access via existing `has_role('operator'|'admin')` pattern.

Backed by a single SECURITY DEFINER RPC `public.edge_function_health(_hours int default 24)` returning the aggregate, plus direct `select` on `edge_request_logs` (RLS already operator-only) for the drawer.

### 3. Browser-side network failures

These (the "Failed to fetch" the user saw) never reach the server, so they can't go in `edge_request_logs`. Add a tiny client wrapper in `src/integrations/supabase/safe-invoke.ts` that catches transport errors from `supabase.functions.invoke` and posts them to a new lightweight edge function `client-error-beacon` → row in `client_error_log`. Sentinel includes those in the same finding when count >= 5 in 30 min.

Out of scope for this turn unless you want it now: paging integrations beyond the existing webhook, rolling window aggregates beyond 24h, per-user error budgets.

## Files

- `supabase/migrations/<new>.sql` — `edge_function_health()` RPC, `client_error_log` table + RLS.
- `supabase/functions/sentinel-tick/index.ts` — add `edge_function_errors` check.
- `supabase/functions/client-error-beacon/index.ts` (new).
- `src/integrations/supabase/safe-invoke.ts` (new) + use it in `Connections.tsx` and other invoke sites incrementally.
- `src/pages/EdgeHealth.tsx` (new) + route + sidebar entry.