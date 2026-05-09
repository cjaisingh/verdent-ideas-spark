---
name: CI/CD hardening (WS6)
description: Branch protection requirements + workflow inventory for main/develop. Lists all required status checks and Dependabot/CodeQL/Gitleaks/Lighthouse/axe/lint-typecheck cadences.
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
- `codeql.yml` — push/PR + Mon 04:23 UTC, `security-and-quality` queries
- `gitleaks.yml` — push/PR + daily 05:13 UTC

**Performance/a11y:**
- `lighthouse.yml` — PR + Mon 06:37 UTC, config in `.lighthouserc.json` (perf 0.7 / a11y 0.85)
- `axe.yml` — PR + Mon 06:47 UTC, WCAG 2.0 AA

**Dependabot** (`.github/dependabot.yml`): npm + github-actions weekly Mon 06:00 UTC. Minor/patch grouped, majors ignored.

Branch protection on `main` is **operator action** (cannot ship from code). Checklist lives in `docs/ci-cd.md` § "Required branch protection on `main`".

Bypass labels: `doc-drift-ok` on PR; `// @logger-exempt: <reason>` in edge function file.
