---
name: Verification discipline
description: What is and isn't verifiable from the Lovable sandbox; required phrasing when state can't be confirmed
type: preference
---

# Verification discipline

When project memory and observable reality disagree, **observable reality wins** and the memory must be corrected the same turn.

## Verifiable from the sandbox
- Files in the project tree (`code--view`, `code--list_dir`, `rg`)
- Edge function source under `supabase/functions/*`
- Lovable Cloud DB schema, RLS, rows (via `psql`, `supabase--read_query`, `supabase--migration`)
- Runtime secrets present (via `secrets--fetch_secrets` — names only, never values)
- Edge function logs (`supabase--edge_function_logs`)
- Cloud project lifecycle state (`supabase--cloud_status`)
- Browser preview behaviour (console, network, session replay)

## NOT verifiable from the sandbox
- Whether a GitHub (or any git) remote is connected to this Lovable project
- Whether anything has actually been pushed, what branch is default, or what the latest commit SHA is
- GitHub Actions / CI run status, branch protection rules, required checks
- Whether the published frontend reflects the current sandbox tree
- Custom domain DNS / TLS state
- Anything inside a separate Lovable/Expo/Rork project unless explicitly accessed via `cross_project--*`

## Required phrasing
For anything in the "not verifiable" list, default to:
> "I can't see this from the sandbox — please confirm in **Project Settings → Git** (or the relevant UI)."

Never write "synced to GitHub", "pushed", "CI passed", "deployed to production", or "the repo has X" unless the operator has just confirmed it in this conversation. A line in `mem://index.md` is not confirmation.

## When the operator corrects you
1. Acknowledge the gap in one sentence.
2. Fix the offending memory file in the same turn.
3. If the mistake is a class of error (not a one-off fact), add or update a rule here.

## Plan-before-fix rules
- **Read live before planning.** First tool call on any "fix findings / triage X" request queries the live source (`sentinel_findings`, `automation_runs`, etc.), never cached state.
- **Detector-wrong before system-broken.** When a finding fires, default hypothesis is "the detector measures the wrong thing." Cheaper to fix one query than diagnose a phantom outage.
- **Verify-before-scope.** "Stop on first green" needs a matching "start on first real signal" — confirm the finding reflects reality before scoping a fix.
