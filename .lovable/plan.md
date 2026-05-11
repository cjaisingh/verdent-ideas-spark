# Fix remaining GitHub Actions failures

Two workflows are red. Each has a confirmed root cause from the failed-run logs.

## 1. CodeQL — setup conflict

**Failure:** `CodeQL analyses from advanced configurations cannot be processed when the default setup is enabled`

**Cause:** The repo has both `.github/workflows/codeql.yml` (advanced) AND GitHub's built-in default CodeQL setup turned on. GitHub rejects SARIF uploads from the workflow.

**Fix (operator action — not code):**
On GitHub → repo `cjaisingh/verdent-ideas-spark` → **Settings → Code security → CodeQL analysis** → switch from **Default** to **Advanced** (or click **Disable** on default setup). This makes the in-repo `codeql.yml` the only source.

I'll update `docs/ci-cd.md` to make this step more prominent (it's already documented but easy to miss).

## 2. Deploy Staging / Production — missing project ref

**Failure:** `supabase db push --linked` exits 1 because there's no linked project (no `supabase/.temp/project-ref` in CI checkout).

**Cause:** `--linked` only works when the CLI has a project ref recorded locally. In CI we have to pass it explicitly.

**Fix (code, in `.github/workflows/`):**
- `deploy-staging.yml` → change push step to:
  ```yaml
  run: supabase db push --project-ref "$SUPABASE_PROJECT_ID" --password "$SUPABASE_DB_PASSWORD"
  ```
  (drop `--linked`; env vars already set: `SUPABASE_PROJECT_ID` = `SUPABASE_STAGING_PROJECT_ID`, `SUPABASE_DB_PASSWORD` = `SUPABASE_STAGING_DB_PASSWORD`)
- `deploy-production.yml` → identical change with prod secrets.

No new secrets needed.

## 3. Verify

After the push lands on the mirror, poll the GitHub API with `GITHUB_REVIEWS_TOKEN` until both workflows show `conclusion: success` on the next triggering run. CodeQL won't go green until you also flip the GitHub setting in step 1 — I'll flag that explicitly if it's still red.

## Out of scope

No model routing changes, no new workflows, no branch-protection edits. Stop on first green signal.
