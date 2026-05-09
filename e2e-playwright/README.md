# Playwright end-to-end tests

Browser-driven smoke + flow tests for the operator console. Complements the
existing API-level e2e suite under `e2e/`.

## Coverage

| Spec | Scenarios |
|---|---|
| `morning-review.spec.ts` | `/morning-review` loads, KPI tiles render, Acknowledge button or badge present, Mirror button (if any open finding) triggers a toast |
| `roadmap.spec.ts` | `/roadmap` renders, `SentinelStatusStrip` is visible, **Tick now** click triggers UI feedback, severity legend buckets render |
| `admin-lessons.spec.ts` | Seeds a proposed lesson, then exercises **Apply / Defer / Reject** end-to-end and asserts the row's `status` flips in the database. Cleans up after itself. |

## Running

```bash
# 1. One-time browser install
bunx playwright install chromium

# 2. Required env
export E2E_BASE_URL="http://localhost:8080"           # or your preview URL
export E2E_SUPABASE_URL="https://<ref>.supabase.co"
export E2E_SUPABASE_ANON_KEY="<publishable key>"
export E2E_OPERATOR_EMAIL="operator@example.com"
export E2E_OPERATOR_PASSWORD="…"

# 3. Run
bunx playwright test
# or, headed for debugging:
bunx playwright test --headed --project=chromium
```

`E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY` fall back to `VITE_SUPABASE_URL`
/ `VITE_SUPABASE_PUBLISHABLE_KEY` from the project `.env`.

## How auth works

The `authedPage` fixture in `fixtures/auth.ts` signs in once via the Supabase
JS SDK, then injects the resulting session into `localStorage` under the
`sb-<project-ref>-auth-token` key (the same key used by
`src/integrations/supabase/client.ts`). No login form is ever filled.

If credentials are not configured, every test in the suite **skips** with a
clear message so the suite can stay in CI without forcing secrets locally.

## CI

Add a job that exports the four `E2E_*` env vars from GitHub Environment
secrets and runs:

```yaml
- run: bunx playwright install --with-deps chromium
- run: bunx playwright test
```

Do not gate PR merges on these tests until the credentials are reliably
available — leave the existing `bun run test:security` suite as the required
check.
