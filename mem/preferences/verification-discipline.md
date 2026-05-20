---
name: Verification discipline
description: Sandbox-verifiable vs not + plan-before-fix rules (read live, detector-wrong-first, verify-before-scope)
type: preference
---

When memory and observable reality disagree, **reality wins** — correct the memory same turn.

## Verifiable from sandbox
Project files; edge fn source; Cloud DB (schema/RLS/rows via `psql`/`read_query`/`migration`); secret names (`fetch_secrets`); edge fn logs; `cloud_status`; browser preview (console/network/replay).

## NOT verifiable
Git remote state; pushes/branches/SHAs; GitHub Actions runs; branch protection; published frontend vs sandbox tree; custom domain DNS/TLS; separate Lovable/Expo/Rork projects (unless via `cross_project--*`).

## Required phrasing
For non-verifiable items: *"I can't see this from the sandbox — please confirm in Project Settings → Git (or relevant UI)."* Never write "synced/pushed/CI passed/deployed" without operator confirmation this turn. A line in `mem://index.md` is not confirmation.

## Plan-before-fix
- **Read live before planning.** First tool call on triage/findings/fix-X queries live source, never cached state.
- **Detector-wrong before system-broken.** Default hypothesis on a finding is "detector measures the wrong thing."
- **Verify-before-scope.** Confirm the finding reflects reality before scoping a fix.

## On correction
Acknowledge in one sentence → fix the offending memory same turn → if it's a class of error, add a rule here.
