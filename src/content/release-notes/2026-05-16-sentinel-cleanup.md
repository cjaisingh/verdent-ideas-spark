# Release notes — Sentinel false-positive cleanup

**Date:** 16 May 2026
**Scope:** Operational fix only — no schema, edge function, or UI changes.

## What changed
- Cleared 3 stale `cron_silence` sentinel findings for `sentinel-tick`, `overnight-phase-runner-15m`, and `morning-review` (IDs `1e94d481`, `c0c0329b`, `ac421474`).
- Closed discussion action `45032d7d` ("Reactivate stalled crons") as `done` with a root-cause note.
- Added a one-line `CHANGELOG.md` entry under `[Unreleased] → Fixed`.

## Why
The three findings were **false positives**. `cron.job_run_details` and `automation_runs` both show the crons firing on schedule (96 ticks/24h for the 15-min jobs; morning-review at 06:00 UTC). The sentinel auto-resolve loop in `sentinel-tick/index.ts` did not close them — gap to investigate later, but not blocking.

## Impact on cron and phase runs
- **No operational impact.** All crons were healthy throughout; nothing was actually paused or stalled.
- Tonight's scheduled jobs (sentinel-tick, overnight-phase-runner-15m, walkthrough at 02:15, lessons-daily, tomorrow-plan-refresh, morning-review at 06:00 UTC) will tick as normal.
- **Phase work overnight:** no roadmap phases currently have `run_overnight=true`, so the overnight phase runner will idle. Flag a phase on `/master-plan` before 21:55 UTC to queue work.
- **Night-eligible discussion actions:** zero open — Night Agent will tick but have nothing to audit.

## Verification
- 0 open high/critical sentinel findings.
- GitHub mirror (`cjaisingh/verdent-ideas-spark`) HEAD = `2773f73`; all 5 CI workflows green (CI, Lint & Typecheck, Logger Validation, Gitleaks, Push on main).
- Doc-drift clean against the latest push.

## Follow-ups (not blocking)
- Investigate why the sentinel auto-resolve loop did not close the three findings on its own — likely RLS on `sentinel_findings.update` or a stale `dedupe_key` from when `sentinel-tick` was still in the `cadenceMin` map.
- Yesterday's transient failures on prior commit `16bd019` (Gitleaks 07:26, Nightly tests 05:31) — only worth chasing if they recur tonight.
