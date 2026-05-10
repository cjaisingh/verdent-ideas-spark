---
name: Review cadence
description: How often each part of the codebase is reviewed (per-PR, daily, weekly, quarterly) and which jobs enforce each cadence
type: preference
---

Authoritative cadence map. When the operator asks "how often do we review X?", consult this — don't improvise.

**Per push/PR (CI):** lint+typecheck (`lint-and-typecheck.yml`), tests+build (`ci.yml`), Supabase linter + RLS matrix (`security-audit.yml`, `rls-matrix.yml`), CodeQL, Gitleaks, doc drift, logger coverage.

**Daily:** Gitleaks (05:13 UTC), nightly e2e (02:00 UTC), morning review (06:00 UTC), app walkthrough (02:15 UTC). Sentinel runs every 15 min.

**Weekly (Mon UTC):** doc-drift sweep (04:29), CodeQL (04:23), AWIP reviews pull (05:30), Lighthouse (06:37), axe (06:47), Dependabot (06:00), lessons synthesis, deep audit weekly.

**Monthly:** deep audit monthly module.

**Quarterly (Jan/Apr/Jul/Oct 1 @ 09:00 UTC):** `quarterly-review-open` edge function opens a `discussion_action` linking to `docs/quarterly-review.md`. Covers scaffold configs, Tailwind drift, Dependabot majors, edge function inventory, cron inventory, mem:// light sweep, ADRs, secrets rotation, sidebar IA, RLS coverage.

**Not on any cadence (do reactively):** ADR creation, route additions, new edge functions, package.json script changes.

**Verification caveat:** GitHub-side workflows are inert until a git remote is connected — see `mem://preferences/verification-discipline`. Supabase-side cron jobs are verifiable via `cron.job`.
