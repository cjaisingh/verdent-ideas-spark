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
| `e2e/rls-matrix.test.ts` | Full RLS access matrix — every public table is checked: anon SELECT/INSERT blocked, operator SELECT allowed, managed tables block direct INSERT. Plus an RPC matrix: anon rejected from `grant_user_role`, `revoke_user_role`, `list_users_with_roles`, `purge_*`, `retention_stats`; operator can call `retention_stats` |
| `e2e/rls-role-matrix.test.ts` | Per-role access matrices: **[anon]** denied across the board (every table + every privileged RPC); **[operator-only]** can read all operator tables, denied on `role_change_audit`, sees only own row in `user_roles`, admin RPCs reject with `not authorized`; **[admin]** full surface incl. `role_change_audit` and `list_users_with_roles`. The operator-only block self-skips when `E2E_OPERATOR_ONLY_*` env vars are not set |
| `e2e/edge-function.test.ts` | 401 on no/invalid auth; 200 with operator JWT; service-token header authorizes; wrong service token rejected; `POST /okr/ingest` is idempotent on replay; validation returns 400 |
| `e2e/security-audit.test.ts` | Calls the Supabase Management API linter and asserts no warnings outside the documented allow-list (the 7 self-checking SECURITY DEFINER functions). Plus role smoke checks on `user_roles`, `role_change_audit`, `has_role`, `grant_user_role`, `api_call_logs` |

## Security suite

`bun run test:security` runs `security-audit.test.ts` + `rls-matrix.test.ts` + `rls-role-matrix.test.ts`. CI runs this on **every pull request to `main`** (so it can be a required status check that blocks merges if new linter warnings appear), on pushes that touch `supabase/migrations/`, and nightly via `.github/workflows/security-audit.yml`. The linter assertion needs `SUPABASE_ACCESS_TOKEN` (a Supabase Personal Access Token) and `SUPABASE_PROJECT_REF`; without them the linter test self-skips and only the role checks run. To verify the **operator-only vs admin** split, also seed a non-admin operator user and set `E2E_OPERATOR_ONLY_EMAIL` / `E2E_OPERATOR_ONLY_PASSWORD` — without them the operator-only matrix self-skips. To enforce blocking, mark the **"Linter + RLS matrix"** check as required in GitHub branch protection for `main`.

### Coverage report

`bun run test:rls-coverage` runs the three RLS test files via vitest's JSON reporter and emits a markdown coverage matrix to `reports/rls-coverage.md` (and to stdout). Each table row shows pass/fail/skip per role × action (anon R/W, operator-only R, operator R/W, admin R), each RPC row shows pass/fail/skip per role, and any failures are listed with their error message for quick triage. Pass `--json` for machine-readable output, or `--out path.md` to change the destination. Exits non-zero on any failed assertion so it can gate CI.

## Adding a CI job

The `quality` job in `.github/workflows/ci.yml` runs unit tests only. To add full e2e, create a separate job (e.g. `e2e-staging.yml` triggered after `deploy-staging.yml`) that exports the env vars from GitHub Environment secrets and runs `bun run test:e2e`.
