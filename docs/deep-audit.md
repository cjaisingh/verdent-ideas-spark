# Deep Audit (WS5)

Platform-wide audit run by the `deep-audit` edge function. Runs five sub-modules and persists results to `public.deep_audit_runs`.

## Cadence

| Cron | Schedule | Cadence flag |
|---|---|---|
| `scheduled-deep-audit-weekly` | Sundays 04:00 UTC | `weekly` |
| `scheduled-deep-audit-monthly` | 1st of month 04:30 UTC | `monthly` |

Manual runs from `/audits` use cadence `manual`.

## Sub-modules

| Module | What it checks | Severity escalation |
|---|---|---|
| `secrets` | `app_secrets.updated_at` age | ≥90d → medium · ≥180d → high |
| `rbac` | admin count + recent grants | 0 admins → critical · 1 → medium · >5 → medium · ≥3 grants/30d → high |
| `automation` | `automation_runs` 7d error rate per job | ≥20% & ≥2 err → medium · ≥50% & ≥3 err → high |
| `rls` | `public.*` tables w/ RLS off or no policies | RLS off → critical · no policies → high |
| `retention` | `retention_stats()` rows past window | ≥7d over → medium · ≥30d over → high |

Each module returns `{module, status, checked, findings[], metrics}`. The aggregator picks the worst per-module status as the run status (`ok`/`warn`/`fail`) and counts severities into `summary`.

## Auto-promotion

Findings with severity `high` or `critical` are auto-promoted:

- Inserted into `public.lessons` with `status='proposed'`, `category='audit:<module>'`, deduped by `dedupe_key = audit:<module>:<title>`.
- Best-effort insert into `public.roadmap_review_findings` (silently skipped on schema mismatch).

Counts surface in `summary.promoted_lessons` / `summary.promoted_findings`.

## Alerting

- Run status `fail` → `dispatchAlert("deep-audit", "audit_fail", …)`.
- Auth failure → alert `auth_failed`.
- Uncaught exception → alert `exception`.

## UI

`/audits` lists recent runs (live via Supabase realtime), shows summary chips, per-module results, and full findings with evidence. **Run now** button triggers a `manual` cadence.

## Tests

`supabase/functions/deep-audit/checks_test.ts` — 11 deterministic Deno tests covering each sub-module's edge cases plus the aggregator.

## Operator runbook

1. **Fail status** → open `/audits`, click the latest run, address `critical` then `high` findings, then re-run.
2. **Auto-promoted lessons** appear at `/admin/lessons` with `category` starting `audit:`. Apply / Defer / Reject as usual.
3. To pause a cadence (e.g. during a planned migration) use `/admin/cron-config` and toggle `scheduled-deep-audit-weekly` / `scheduled-deep-audit-monthly`.
