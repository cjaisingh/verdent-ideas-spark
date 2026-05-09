# CI/CD

This project uses GitHub Actions. Three workflows live in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | every push + PRs to `main`/`develop` | Lint, typecheck, test, build, upload `dist` artifact |
| `deploy-staging.yml` | push to `develop` (or manual) | Build, push DB migrations, deploy edge functions, deploy frontend to staging |
| `deploy-production.yml` | push to `main` or `v*.*.*` tag (or manual) | Re-runs quality gates, then deploys DB + edge + frontend to production |

## Branch model

- `develop` → staging
- `main` → production (protect with required `CI` check + review)
- Feature branches → PR into `develop`; CI must be green to merge

## Required GitHub secrets

Set these in **Settings → Secrets and variables → Actions** (and per-environment for staging/production where noted).

**Repository-level (build)**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

**Supabase CLI**
- `SUPABASE_ACCESS_TOKEN` — personal access token from https://supabase.com/dashboard/account/tokens

**Environment: `staging`**
- `SUPABASE_STAGING_PROJECT_ID`
- `SUPABASE_STAGING_DB_PASSWORD`

**Environment: `production`**
- `SUPABASE_PROD_PROJECT_ID`
- `SUPABASE_PROD_DB_PASSWORD`

Add hosting-provider tokens (Vercel/Netlify/Cloudflare) under each environment as you wire up the final deploy step in `deploy-staging.yml` / `deploy-production.yml`.

## Environment protection

In **Settings → Environments**, configure:
- `staging` — no approval required
- `production` — required reviewer(s), restrict to `main` branch + tags

## Lovable note

This pipeline is for self-hosted deployments. If you publish through Lovable's hosted preview, frontend deploys still happen via the **Publish** button — these workflows are useful when you want to mirror the app to your own infrastructure or run gated production releases.

## WS6 hardening workflows (added 2026-05-09)

Three new GitHub Actions workflows enforce the operational-maturity acceptance criteria from `docs/workstream-success-metrics.md`:

| Workflow | Trigger | What it does | Bypass |
|---|---|---|---|
| `doc-drift.yml` | PR to `main`/`develop` | Runs `scripts/check-doc-drift.ts`. Fails if edge functions, migrations, or pages changed without matching docs/CHANGELOG/README updates. | Apply label `doc-drift-ok` to the PR. |
| `logger-validation.yml` | Push + PR (when `supabase/functions/**` changes) | Runs `scripts/check-logger-coverage.ts`. Fails if any edge function's `index.ts` is missing the `withLogger` wrapper from `_shared/logger.ts`. | Add `// @logger-exempt: <reason>` at the top of the file. |
| `changelog-generation.yml` | PR to `main` (non-draft) | Runs `scripts/generate-changelog-entry.ts` and posts/updates a sticky comment with a Conventional-Commits-bucketed snippet to paste into `CHANGELOG.md`. | n/a — informational only, never fails the build. |

All three scripts are runnable locally:

```bash
BASE_REF=main bun run scripts/check-doc-drift.ts
bun run scripts/check-logger-coverage.ts
BASE_REF=main bun run scripts/generate-changelog-entry.ts
```
