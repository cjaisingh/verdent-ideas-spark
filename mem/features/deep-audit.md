---
name: Deep Audit
description: Weekly Sun 04:00 UTC + monthly 1st 04:30 UTC platform audit. 5 modules (secrets/rbac/automation/rls/retention) with auto-promotion of high+critical findings to lessons.
type: feature
---

`deep-audit` edge function — `supabase/functions/deep-audit/{index.ts,checks.ts,checks_test.ts}`.

Runs 5 sub-modules:
- `secrets` — `app_secrets.updated_at` age (≥90d medium, ≥180d high)
- `rbac` — admin count (0 critical, 1 medium, >5 medium) + admin-grants ≥3/30d high
- `automation` — `automation_runs` 7d per-job error rate (≥20%/2err medium, ≥50%/3err high)
- `rls` — `public.*` tables: RLS off → critical, no policies → high
- `retention` — rows past `retention_settings` window (≥7d medium, ≥30d high)

Aggregator picks worst module status as run status (ok/warn/fail). High+critical findings auto-promoted into `public.lessons` (dedupe_key=`audit:<module>:<title>`) and best-effort into `roadmap_review_findings`.

Persisted in `public.deep_audit_runs` (operator-read RLS, realtime). Surfaced at `/audits`. Cron jobs: `scheduled-deep-audit-weekly`, `scheduled-deep-audit-monthly` (managed via `/admin/cron-config` once registered there).

`fail` status fires `dispatchAlert("deep-audit", "audit_fail", …)`. Auth failures fire `auth_failed`. Same service-token cron auth pattern as `sentinel-tick`.

Mapped to ISO 27001 Annex A controls in `docs/iso27001-controls.md` (A.5.17, A.5.18, A.5.36, A.8.2, A.8.3, A.8.10, A.8.16).
