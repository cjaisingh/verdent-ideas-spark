
## Goal
Add a clearly-titled section documenting the three production deploy secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_ID`, `SUPABASE_PROD_DB_PASSWORD`) and where to find each value, so the next time someone wants to enable Deploy Production they have a single page to follow.

## Scope
Documentation only. No workflow edits, no code, no migrations.

## Changes

### 1. `docs/ci-cd.md` — new section "Production deploy secrets — where to find each value"
Inserted directly after the existing "Required GitHub secrets" list (around line 37). A 3-row table:

| Secret | Where to get it | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens → "Generate new token" | Personal access token, scoped to your account; rotate via the same page. One token works for both staging and prod. |
| `SUPABASE_PROD_PROJECT_ID` | Production project → Project Settings → General → "Reference ID" (also visible as `agzkyzyzopcgeobofjaz`-style slug in the dashboard URL) | This is the **prod** project ref, not the dev/Lovable Cloud one. |
| `SUPABASE_PROD_DB_PASSWORD` | Production project → Project Settings → Database → "Database password" → "Reset database password" if you've lost it | Resetting forces a `supabase link` re-run on next deploy. |

Then a short "How to add them" block: GitHub → repo → Settings → Secrets and variables → Actions → New repository secret (or under environment `production` if you want approval gating).

Reminder line: Deploy Production is currently `workflow_dispatch` only (see `deploy-production.yml` header) and won't run on push until these are set.

### 2. `README.md` — one-line pointer
Under the existing "CI/CD" docs link entry, add a sub-bullet: "Production deploy secrets reference — see [docs/ci-cd.md § Production deploy secrets](docs/ci-cd.md#production-deploy-secrets--where-to-find-each-value)".

### 3. `CHANGELOG.md` — `### Documented` entry
"Production deploy secrets reference — `docs/ci-cd.md` now has a 3-row table mapping each required prod secret (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_ID`, `SUPABASE_PROD_DB_PASSWORD`) to its exact location in the Supabase dashboard."

## Verification
`rg -n "Production deploy secrets" docs/ci-cd.md README.md CHANGELOG.md` should return matches in all three files.

## What I will NOT do
- Touch `deploy-production.yml` (already manual-only).
- Add staging-secret docs (already covered).
- Create new docs files — keeping prod-secret guidance co-located with the existing CI/CD doc avoids drift.
