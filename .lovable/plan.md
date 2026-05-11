# Fix GitHub deploy failure at the source

## What’s actually happening
Your app code is not the thing failing anymore.

Current evidence from the repo’s GitHub Actions runs:
- `CI` passes
- `Lint & Typecheck` passes
- `Logger Validation` passes
- `Security audit` passes
- `CodeQL` is currently running
- `Deploy Production` fails consistently

The failure is specifically this workflow step:
```text
Push database migrations (production)
```
And the exact error is:
```text
unknown flag: --project-ref
```
So this is a workflow command bug, not an endless app-level bug hunt.

## Plan

### 1. Correct the production deploy workflow
Update `.github/workflows/deploy-production.yml` so the migration/deploy steps use the Supabase CLI correctly for CI.

Replace the broken pattern:
```bash
supabase db push --project-ref "$SUPABASE_PROJECT_ID" --password "$SUPABASE_DB_PASSWORD"
```
with the proper non-interactive flow:
```bash
supabase link --project-ref "$SUPABASE_PROJECT_ID" --password "$SUPABASE_DB_PASSWORD"
supabase db push
```
And apply the same pattern for function deployment if needed.

### 2. Make the workflow fail clearly when production secrets are missing
Right now the build log shows frontend env secrets are blank, and the production migration step depends on backend deploy secrets too.

I’ll add a lightweight validation step so the workflow explains missing production secrets up front instead of failing later with a misleading CLI error.

Secrets to validate in the workflow:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROD_PROJECT_ID`
- `SUPABASE_PROD_DB_PASSWORD`
- optionally the frontend build secrets if production deploy really depends on them

### 3. Keep scope tight: fix deploy, don’t touch product code
No governance/UI/schema work in this pass.
This is a CI/CD repair slice only, aimed at stopping the repeated failed emails and preventing more wasted cycles.

### 4. Verify against GitHub Actions after the change lands
After updating the workflow, I’ll verify the next run status from GitHub Actions so I can tell you one of these clearly:
- workflow fixed and production deploy is green
- workflow syntax fixed, but a missing secret or remote migration conflict still blocks deploy

If there’s a second blocker, it will be concrete and singular rather than another blind retry.

## Expected outcome
Best case: production deploy goes green immediately.

If not, we’ll have reduced the problem from “GitHub keeps failing” to one explicit remaining blocker such as:
- missing production backend credentials
- remote migration drift/conflict
- function deploy auth issue

## Technical notes
- Root cause confirmed from GitHub Actions logs, not inferred.
- The current failing command uses an invalid flag for `supabase db push`.
- This is why repeated app edits won’t solve the GitHub failure.

## Why this is the right next move
This is the minimum-credit, maximum-signal path:
- one workflow fix
- one validation pass
- one post-fix check

No more speculative attempts.