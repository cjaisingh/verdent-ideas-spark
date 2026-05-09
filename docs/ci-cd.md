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

## WS6 hardening — additional gates (added 2026-05-09)

| Workflow | Trigger | Purpose |
|---|---|---|
| `lint-and-typecheck.yml` | every push + PR | Fast feedback gate (lint + `tsc --noEmit`). Mark required in branch protection. |
| `codeql.yml` | push, PR, weekly Mon 04:23 UTC | GitHub CodeQL static analysis (`security-and-quality` queries). Findings appear under **Security → Code scanning**. |
| `gitleaks.yml` | push, PR, daily 05:13 UTC | Repo-wide secret scan via `gitleaks-action`. Uploads SARIF to **Security → Secret scanning**. |
| `lighthouse.yml` | PR, weekly Mon 06:37 UTC | Lighthouse CI against built `dist/` using `.lighthouserc.json` (perf 0.7, a11y/best-practices/SEO 0.85, all `warn`). |
| `axe.yml` | PR, weekly Mon 06:47 UTC | `@axe-core/cli` against served `dist/`, WCAG 2.0 A + AA tags. Report uploaded as artifact. |
| `doc-drift.yml` | PR + weekly Mon 04:29 UTC | (extended) Now also runs weekly against `main` to surface drift accumulated outside PR flow. |

`dependabot.yml` keeps npm + GitHub-Actions deps fresh: weekly Monday 06:00 UTC, minor/patch grouped, majors ignored (manual review).

## Required branch protection on `main`

Operator action — not enforceable from code. In **Settings → Branches → main**:

1. **Require pull request reviews** (≥ 1 approver, dismiss stale reviews on new commits).
2. **Require status checks to pass** before merging — mark these required:
   - `Lint + Typecheck` (`lint-and-typecheck.yml`)
   - `Lint · Typecheck · Test · Build` (`ci.yml`)
   - `Linter + RLS matrix` (`security-audit.yml`)
   - `Check docs and changelog parity` (`doc-drift.yml`)
   - `Analyze (javascript-typescript)` (`codeql.yml`)
   - `Secret scan` (`gitleaks.yml`)
3. **Require branches to be up to date** before merging.
4. **Require linear history** (squash-merge only).
5. **Restrict pushes** — only allow merges via PR; block direct pushes (including admins where possible).
6. **Require signed commits** (recommended, not required).
7. **Lock force-pushes and deletions** on `main`.

Mirror a relaxed version on `develop`: same checks but allow direct pushes from maintainers for fast-iteration spikes.
