## Lessons learned from this exchange

1. **Memory is not ground truth.** The Core line `GitHub repo (not GitLab)` was treated as current state. It described intent, not reality — no repo was actually connected. I repeated the claim three times before your screenshot forced a correction.
2. **"Auto-sync to GitHub" requires a connected provider.** Lovable does not push anywhere until Project Settings → Git is wired up. Edge functions and runtime secrets deploy to Lovable Cloud independently of git, which made the mistake easy to miss.
3. **CI workflows in `.github/workflows/*.yml` are inert without a remote.** Every assumption in `mem/preferences/ci-cd-hardening.md` about "checks green on `main`" is unverified until the repo exists.
4. **When observable reality (your screenshot) and project memory disagree, reality wins** — and the memory must be corrected immediately so the next session doesn't repeat the error.
5. **Never assert deploy / sync / CI status I can't directly verify** from the sandbox. Default phrasing should be "I can't see this from here — please confirm" instead of confident claims.

## Plan to update learning

### A. Fix the stale Core rule in `mem://index.md`
Replace the line:
> `GitHub repo (not GitLab). Nightly + weekly automation surfaced…`

with:
> `Git provider: not yet connected — verify in Project Settings → Git before claiming anything is "in GitHub" or that CI ran. Nightly + weekly automation surfaced on /roadmap via AutomationPanel + SentinelStatusStrip; overview lives at /overnight; daily hygiene at /morning-review.`

### B. Add a new Core rule (one line)
> `Never claim deploy / git-sync / CI status from memory alone. If it cannot be verified from the sandbox, say "unverified" and ask the operator.`

### C. New memory file `mem/preferences/verification-discipline.md`
One-screen rule sheet covering:
- What is verifiable from the sandbox (files in tree, edge function code, runtime secrets list, Cloud DB via tools)
- What is NOT verifiable (GitHub remote, CI run status, branch protection, published frontend version, custom domain DNS)
- Required phrasing for the unverifiable category
- Add reference under `## Memories` in `mem://index.md`

### D. Append a row to `public.lessons` (the Lessons Loop table)
Title: "Verify external state before asserting it"  
Body: condensed version of points 1–5 above  
Severity: `medium`  
Source: `manual` (operator-recorded, not from weekly synthesis)  
This puts the lesson on `/admin/lessons` so it surfaces in normal review, not just in agent memory.

### E. Add an `[Unreleased]` CHANGELOG entry under `Changed`
> `Memory: corrected stale "GitHub repo connected" assumption; added verification-discipline rule and a manual lesson to public.lessons.`

## Out of scope
- No code changes.
- No connecting the repo (you do that in the Lovable UI).
- No edits to the doc files created earlier — they're fine, just not yet pushed anywhere.

## After this lands
Once you connect GitHub via Project Settings → Git, I'll re-verify the doc set landed on the default branch and update the Core rule again to reflect the connected state.
