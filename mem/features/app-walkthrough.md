---
name: App walkthrough
description: Nightly self-walkthrough — route probes + capability verify-checks → walkthrough_runs/checks → sentinel_findings
type: feature
---

`scheduled-app-walkthrough` cron at **02:15 UTC** → edge fn `app-walkthrough` (auth `x-service-token` AWIP_SERVICE_TOKEN; awip-api targets ALSO need `x-awip-service-token` — function sends both).

Pipeline (5 steps):
1. `walkthrough_runs` row inserted (status=running)
2. Static route probes from `supabase/functions/app-walkthrough/probes.ts` (AWIP_API_PROBES, EDGE_FN_PROBES, optional uiRouteProbes when caller passes `preview_origin`)
3. For each `capabilities.verify is not null` → dispatch `http` | `sql` | `edge`. SQL goes through `public.run_capability_sql_check(_sql,_min_rows)` (service-role only, single SELECT, 5s timeout)
4. `walkthrough_checks` rows inserted (chunks of 100); run row updated with totals + status (`ok`/`partial`/`failed`)
5. Each `fail`/`error` upserts `sentinel_findings` (`kind='walkthrough_failure'`, `dedupe_key='walkthrough:<target>'`) → weekly Lessons Loop consumes

Tables (operator-only RLS, realtime on): `walkthrough_runs`, `walkthrough_checks`. Capability column added: `capabilities.verify jsonb`.

UI: `/walkthrough` page + `WalkthroughCard` on `/roadmap` AutomationPanel. Channel names follow per-mount UUID rule.

Manual run: `supabase.functions.invoke('app-walkthrough')` from operator session, or curl with `x-service-token` header.

Deferred (todos): Hermes-style cross-session recall (index walkthrough_checks failures + sentinel + lessons into awip-rag); AI visual sweep; auto-discussion-action when a check flaps.
