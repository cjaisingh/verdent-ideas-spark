---
name: CI/CD hardening (WS6)
description: Branch protection requirements + workflow inventory for main/develop. Lists all required status checks and Dependabot/Gitleaks/Lighthouse/axe/lint-typecheck cadences. CodeQL intentionally disabled.
type: preference
---

GitHub Actions inventory (all in `.github/workflows/`):

**Quality gates (required on `main` PRs):**
- `lint-and-typecheck.yml` — every push, fast feedback
- `ci.yml` — lint+typecheck+test+build
- `security-audit.yml` — Supabase linter + RLS matrix
- `doc-drift.yml` — PR + weekly Mon 04:29 UTC
- `logger-validation.yml` — `withLogger` coverage

**Security scans:**
- `gitleaks.yml` — push/PR + daily 05:13 UTC
- ~~`codeql.yml`~~ — **removed 2026-05-18**. 28 unactioned alerts, no triage capacity; Gitleaks + Security Audit + Dependabot cover the gap. Default setup also disabled in repo settings. Do NOT re-add without a named triage owner.

**Performance/a11y:**
- `lighthouse.yml` — PR + Mon 06:37 UTC, config in `.lighthouserc.json` (perf 0.7 / a11y 0.85)
- `axe.yml` — PR + Mon 06:47 UTC, WCAG 2.0 AA

**Dependabot** (`.github/dependabot.yml`): npm + github-actions weekly Mon 06:00 UTC. Minor/patch grouped, majors ignored.

Branch protection on `main` is **operator action** (cannot ship from code). Checklist lives in `docs/ci-cd.md` § "Required branch protection on `main`".

**Deploy Production (`deploy-production.yml`) is `workflow_dispatch` only** until `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROD_PROJECT_ID` / `SUPABASE_PROD_DB_PASSWORD` are configured in repo Settings → Secrets. Do NOT re-add `push: branches: [main]` without setting all three first — otherwise every push emails a red workflow.

**CodeQL** — disabled 2026-05-18. Workflow file deleted; operator also disables default setup in repo settings + bulk-dismisses outstanding alerts.

Bypass labels: `doc-drift-ok` on PR; `// @logger-exempt: <reason>` in edge function file.
