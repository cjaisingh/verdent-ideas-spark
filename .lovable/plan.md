## What’s actually happening

The GitHub errors are real, and I can see them now.

Latest public runs on `cjaisingh/verdent-ideas-spark` show multiple genuine failures on `main`:
- `CI` → failed
- `Lint & Typecheck` → failed
- `Deploy Production` → failed
- `CodeQL` → failed
- `Security audit` → failed

This is not a GitHub outage, and the jobs-board auto-sync does not fix the workflows themselves — it only mirrors workflow status into the app.

## Why those workflows are failing

### 1) CI / Lint / Deploy are failing because the repo is currently lint-red
I reproduced the failure locally from the repo scripts. Current hard ESLint errors include:
- `e2e-playwright/fixtures/auth.ts` — Playwright fixture callback uses a parameter named `use`, which trips `react-hooks/rules-of-hooks`
- `src/components/AutomationPanel.tsx` — unused-expression, useless escape, prefer-const issues
- `src/components/EvidencePanel.tsx` — `prefer-const`

Because `ci.yml` and `deploy-production.yml` both run `bun run lint`, they fail immediately once lint is red.

### 2) Security audit is failing from env/workflow setup, not just GitHub itself
The security suite requires real E2E operator credentials and backend env vars. The test harness expects:
- `E2E_OPERATOR_EMAIL`
- `E2E_OPERATOR_PASSWORD`
- plus the E2E backend vars

The workflow is wired to a GitHub `staging` environment and is sensitive to secret naming / presence there. The local run fails immediately when those E2E vars are absent, which matches the kind of fast failure shown in your screenshots.

### 3) CodeQL is likely failing because the workflow is using generic `autobuild` on a Bun/Vite repo
`codeql.yml` currently does:
- checkout
- CodeQL init
- `github/codeql-action/autobuild`
- analyze

That pattern is often fragile on Bun projects. This repo likely needs an explicit JS/TS setup flow instead of relying on `autobuild`.

## Why my earlier answer was incomplete

I checked workflow status and branch settings, but I had not yet drilled into the actual failing workflow definitions and reproduced the repo scripts behind them. That part is on me.

## Plan to fix it

### 1) Make the repo green again
- Fix the current ESLint-breaking files
- Re-run the same scripts GitHub runs (`lint`, targeted tests)
- Ensure `CI`, `Lint & Typecheck`, and `Deploy Production` stop failing on lint

### 2) Harden `codeql.yml`
- Replace or adjust `autobuild` for this Bun/Vite TypeScript project
- Use an explicit setup that matches the repo instead of the generic default
- Re-test on the next push

### 3) Reconcile the security-audit workflow with the required secrets
- Verify the workflow’s expected GitHub environment secrets against the test harness
- Align any mismatched names/docs
- Make the job either run successfully with the configured secrets or fail with a clearer reason

### 4) Clean up the jobs board linkage
- Keep the jobs-board auto-sync
- Update linked jobs so they reflect the real blockers: lint failures, CodeQL workflow wiring, and security-audit env setup

### 5) Verify from GitHub after the next push
- Re-poll the live GitHub runs
- Confirm which workflows go green and which, if any, still need follow-up

## Technical details

Files most likely needing changes:
- `.github/workflows/codeql.yml`
- `.github/workflows/security-audit.yml`
- `e2e-playwright/fixtures/auth.ts`
- `src/components/AutomationPanel.tsx`
- `src/components/EvidencePanel.tsx`
- possibly docs if secret names or workflow expectations are out of sync

Success criteria:
- `Lint & Typecheck` passes
- `CI` passes
- `Security audit` has valid env wiring and passes or fails with one explicit actionable cause
- `CodeQL` runs successfully on the repo
- I can confirm the result from the live GitHub API after the next push