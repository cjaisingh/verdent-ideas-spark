## Goal

Stop all CodeQL noise. You'll rely on Gitleaks, Security Audit (Supabase linter + RLS matrix), Dependabot, and lint/typecheck — CodeQL adds no signal we're acting on.

## What I'll do (in code)

1. **Delete `.github/workflows/codeql.yml`** — kills the advanced workflow and the Monday 04:23 UTC schedule.
2. **Update `mem/preferences/ci-cd-hardening.md`** — remove `codeql.yml` from the workflow inventory; note CodeQL is intentionally off.
3. **Update `docs/ci-cd.md`** — strike the "CodeQL: default vs advanced setup" section; replace with a one-liner: "CodeQL disabled 2026-05-18, see CHANGELOG."
4. **`CHANGELOG.md`** — entry under today: "Disabled CodeQL (advanced workflow removed, default setup to be turned off in repo settings). Rationale: 28 unactioned alerts, no triage capacity, other scanners cover the gap."
5. **Close discussion_action #25** via migration — mark `done` with note "Superseded: CodeQL fully disabled, not switched to advanced."
6. **Open a new low-risk discussion_action** "Turn off GitHub default CodeQL setup + dismiss 28 alerts" — operator-only one-click task, tagged `ci-cd`.

## What you do (one-off, in GitHub UI — I can't reach it)

1. `Repo → Settings → Code security → Code scanning → CodeQL analysis → Set up ▾ → Disable`. This stops the default-setup runs and prevents new alerts.
2. `Repo → Security → Code scanning → filter Tool: CodeQL → select all → Dismiss → reason: "Won't fix"`. Bulk-dismisses all 28.

Order doesn't matter; doing #1 first means no new alerts arrive while you dismiss.

## Out of scope

- Re-enabling CodeQL later (would need a fresh decision + triage owner).
- Touching Gitleaks / Security Audit / Dependabot — they stay.
- Any `codemod_replace_any` work (separate track, already shipped).

## Files

- delete `.github/workflows/codeql.yml`
- edit `mem/preferences/ci-cd-hardening.md`
- edit `docs/ci-cd.md`
- edit `CHANGELOG.md`
- new migration: close action #25, insert new action for the repo-settings cleanup
