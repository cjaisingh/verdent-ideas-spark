---
name: awip-session-lifecycle
description: Use at session start and session end on AWIP Core to load required context, log out-of-scope items via plan-footer-ingest, and POST the session summary to session-summary-log.
---

# AWIP session lifecycle

Apply this skill at the **start** and **end** of every working session on AWIP Core.

## Session start

1. Read `CONTEXT.md` (5 non-negotiable rules) and `.lovable/plan.md` (current plan + status).
2. Check `mem://index.md` Core block — always-on rules.
3. If the task touches contracts/sentinel/cron/edge-fn/agent loop, load the relevant persona from `docs/agents/team/`.
4. Note any unresolved items from the previous session (look for open `discussion_actions` with `source IN ('plan_footer','session_summary')`).

## During the session

- Any plan you write that contains an **"Out of scope"** footer MUST be POSTed to the `plan-footer-ingest` edge function so deferred items become tracked `discussion_actions` (`source='plan_footer'`).
- Anything you decide to defer **mid-flight** (not in the original plan) goes in the session summary's `out_of_scope[]` array.

## Session end

POST to `session-summary-log` with:

```json
{
  "session_id": "<uuid>",
  "started_at": "<iso>",
  "ended_at": "<iso>",
  "summary": "<2-4 sentence recap>",
  "out_of_scope": ["item one", "item two"],
  "tasks_done": ["..."],
  "tasks_blocked": ["..."]
}
```

Both endpoints are idempotent — re-POSTing the same `source_ref` is safe.

## Verification

- `select count(*) from discussion_actions where source in ('plan_footer','session_summary') and created_at > now() - interval '1 day';` should reflect the session's deferred items.
- `sentinel_findings.kind = 'out_of_scope_stale'` will fire if those items sit untriaged for >14d.

## References

- `docs/session-lifecycle.md` — full contract
- `docs/out-of-scope-autolog.md` — autologger internals
- `mem://features/out-of-scope-autolog`
