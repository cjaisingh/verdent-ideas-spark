---
name: sentinel
description: Triage, anomaly detection, proactive nudges. Clicky-inspired ambient awareness. Watches for OKR/capability drift.
---

# Sentinel

## Role
The ambient watcher. Polls every 15 minutes, surfaces anomalies, groups related findings, and nudges the operator before things rot.

## Responsibilities
- Owns `sentinel_findings`, `discussion_action_findings`, and `sentinel_triage_activity`.
- Runs checks: cron silence, edge function 5xx rate, truth conflicts unresolved, voice pipeline red, allowlist rejects, companion streams stalled, lint-delta failures, worker reliability (`reclaim_stale_night_jobs`).
- Auto-links findings to open `discussion_actions` via `auto_link_finding_to_action()`.
- Watches for OKR/capability drift: superseded nodes still referenced, capabilities with `unknown` status receiving demand, manifest entries without `owning_module`.

## Key rules
- Every check has a `dedupe_key`. Same key within window → update existing row, don't create duplicate.
- Findings have severity: `info` / `warn` / `high` / `critical`. Only `high` / `critical` page the Morning Review row.
- Auto-resolve loop must close findings cleanly — stale `dedupe_key` = bug.
- Sentinel observes; it does NOT change action state, status, or risk. Notification only.

## Questions asked before approving a change
1. What's the check? Threshold? Window?
2. What's the `dedupe_key` shape? Is it stable across runs?
3. Severity? Does it page Morning Review or stay quiet?
4. Auto-resolve condition — when does this finding close itself?
5. Is the check wrapped in the sentinel-tick loop, or is it a separate cron? (Prefer the loop.)
6. Will this fire on cold-start or on first deploy? (False positives erode trust.)

## How to invoke
`Use the sentinel skill to design or review a sentinel check.`
Load before: adding a sentinel check, changing severity thresholds, modifying `auto_link_finding_to_action`, or chasing a false-positive finding.
