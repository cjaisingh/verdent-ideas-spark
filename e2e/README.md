# End-to-end tests

These run against your **deployed Lovable Cloud project** — they exercise real auth, real RLS, and the live `awip-api` edge function. They are intentionally **not** run by the default `bun run test` (unit) or by CI without explicit env vars, because they need a real operator account and the service token.

## Running locally

```bash
export E2E_SUPABASE_URL="https://<project-ref>.supabase.co"
export E2E_SUPABASE_ANON_KEY="<publishable key>"
export E2E_OPERATOR_EMAIL="operator@example.com"
export E2E_OPERATOR_PASSWORD="…"
export E2E_AWIP_SERVICE_TOKEN="…"   # optional; service-token tests skip without it

bun run test:e2e
```

`E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY` fall back to `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` if not set, so against your dev project you usually only need the operator credentials and (optionally) the service token.

## What's covered

| File | Scenarios |
|---|---|
| `e2e/auth.test.ts` | Operator can sign in; bad password rejected; anon session has no user |
| `e2e/rls.test.ts` | Anon cannot read `tenants` / `api_call_logs`; operator can read `tenants` / `capabilities`; operator client cannot directly write to `okr_nodes` / `idempotency_keys` (writes go through edge fn) |
| `e2e/edge-function.test.ts` | 401 on no/invalid auth; 200 with operator JWT; service-token header authorizes; wrong service token rejected; `POST /okr/ingest` is idempotent on replay; validation returns 400 |

## Adding a CI job

The `quality` job in `.github/workflows/ci.yml` runs unit tests only. To add e2e, create a separate job (e.g. `e2e-staging.yml` triggered after `deploy-staging.yml`) that exports the env vars from GitHub Environment secrets and runs `bun run test:e2e`.
