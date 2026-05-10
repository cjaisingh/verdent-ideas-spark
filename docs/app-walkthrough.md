# App walkthrough (nightly self-walkthrough)

Borrowed from Hermes Agent's "skills with verify-checks" idea: every capability can declare a self-test, and a nightly job runs them all alongside static route probes.

## What runs

Cron `scheduled-app-walkthrough` at **02:15 UTC** invokes `app-walkthrough` (auth: `x-service-token` = `AWIP_SERVICE_TOKEN`).

Pipeline:

1. **Static route probes** (`probes.ts`): awip-api endpoints + edge function smoke checks (OPTIONS / GET).
2. **UI route probes** (only when caller passes `preview_origin` in the POST body — cron doesn't).
3. **Capability self-tests**: for every row in `public.capabilities` where `verify is not null`, dispatch `http` / `sql` / `edge`.
4. **Persist**: one row in `walkthrough_runs`, one per check in `walkthrough_checks`.
5. **Failure → sentinel**: each `fail`/`error` upserts `sentinel_findings` with `kind='walkthrough_failure'`, `dedupe_key='walkthrough:<target>'`. Weekly Lessons Loop already consumes sentinel findings.

## Declaring a verify-check

`capabilities.verify` is a JSONB blob:

```json
{
  "kind": "http" | "sql" | "edge",
  "target": "/awip-api/capabilities" | "select 1" | "morning-review",
  "method": "GET",
  "auth": "service" | "none",
  "expect": { "status": 200, "json_has": ["nodes"], "min_rows": 1, "max_ms": 5000 },
  "severity": "low" | "medium" | "high" | "critical"
}
```

`sql` checks call `public.run_capability_sql_check(_sql, _min_rows)` — service-role only, single SELECT, 5s statement timeout, no DDL/DML keywords allowed.

## Pages

- `/walkthrough` — run history with per-check breakdown and a Run-now button.
- `/roadmap` (AutomationPanel) — `WalkthroughCard` showing latest pass/fail.

## Verified

Initial manual run on 2026-05-10 returned 10/10 passing. After deploy I will not assert further about cron — the next scheduled run can be verified from `/walkthrough` or via `select * from walkthrough_runs order by started_at desc limit 5`.
