# ISO 27001 control mapping

Tracks which AWIP automations and tables provide evidence for ISO/IEC 27001:2022 Annex A controls. Not a certification claim — internal mapping for audit prep.

Sibling AIMS view: [`iso42001-gap-analysis.md`](./iso42001-gap-analysis.md) (ISO/IEC 42001 gap analysis against current AI surfaces).

| Annex A control | AWIP coverage | Evidence |
|---|---|---|
| **A.5.1** Policies for information security | `mem://` rules + `docs/security.md` | repo |
| **A.5.15** Access control | `user_roles` + `has_role()` + RLS on every public table | `deep-audit:rls` module |
| **A.5.16** Identity management | Supabase Auth + `bootstrap_first_operator()` | auth.users |
| **A.5.17** Authentication information | `app_secrets` + 90/180-day rotation alerts | `deep-audit:secrets` |
| **A.5.18** Access rights review | Quarterly review of `user_roles`; admin spike alert | `deep-audit:rbac` |
| **A.5.23** Cloud services | Lovable Cloud (Supabase) — single provider | `docs/architecture.md` |
| **A.5.24** Incident management planning | `sentinel_findings` + `dispatchAlert` | `docs/sentinel.md` |
| **A.5.25** Assessment of incidents | `/morning-review` + `/audits` | dashboards |
| **A.5.30** ICT readiness for business continuity | Daily Supabase backups + edge fn re-deploy on push | provider + CI |
| **A.5.34** Privacy & PII | RLS on `profiles`, `discussion_actions`; no PII in logs | `edge_request_logs` redaction |
| **A.5.36** Compliance | `deep-audit` weekly + monthly + auto-promoted lessons | this doc |
| **A.6.3** Awareness, education, training | `docs/development.md`, `docs/runbook` | repo |
| **A.8.2** Privileged access rights | `role_change_audit` + admin grants ≥3/30d alert | `deep-audit:rbac` |
| **A.8.3** Information access restriction | RLS + `has_role()` + service-token cron auth | `deep-audit:rls` |
| **A.8.4** Access to source code | GitHub branch protection on `main` (operator action) | `docs/ci-cd.md` |
| **A.8.5** Secure authentication | Operator JWT + `x-awip-service-token` for cron | edge functions |
| **A.8.7** Protection against malware | Dependabot weekly + CodeQL + Gitleaks | `.github/workflows/` |
| **A.8.8** Management of technical vulnerabilities | Dependabot + `security-audit.yml` + `deep-audit` | CI |
| **A.8.9** Configuration management | `supabase/migrations/` + `supabase/config.toml` | repo |
| **A.8.10** Information deletion | `retention_settings` + `auto_purge_if_enabled()` | `deep-audit:retention` |
| **A.8.11** Data masking | Logger redacts auth headers; secret-value previews only | `_shared/logger.ts` |
| **A.8.12** Data leakage prevention | Gitleaks daily + CodeQL weekly | CI |
| **A.8.15** Logging | `edge_request_logs` + `frontend_error_logs` + `automation_runs` | tables |
| **A.8.16** Monitoring activities | Sentinel (15min) + Morning review (daily) + Deep audit (weekly/monthly) | `/automation`, `/morning-review`, `/audits` |
| **A.8.20** Network security | Supabase managed network + CORS allowlist | edge functions |
| **A.8.23** Web filtering | n/a — internal operator console |  |
| **A.8.24** Use of cryptography | TLS-only (Supabase) + JWT signatures | provider |
| **A.8.25** Secure development life cycle | `docs/development.md` + CI gates | repo |
| **A.8.26** Application security requirements | RLS-first design; `withLogger`; no raw SQL | code |
| **A.8.28** Secure coding | ESLint + tsc + CodeQL `security-and-quality` | CI |
| **A.8.29** Security testing | `e2e/security-audit`, `e2e/rls-matrix` | CI |
| **A.8.32** Change management | Migrations + `deploy-staging` → `deploy-production` | CI |
| **A.8.34** Protection of information systems during audit testing | Audit jobs read-only via SECURITY DEFINER fns | `deep-audit` |

## Gap log

- **A.5.30 BC drill** — No documented restore drill. TODO: quarterly restore-from-snapshot exercise.
- **A.8.6 Capacity management** — No automated capacity dashboard. Tracked via Supabase project metrics manually.
- **A.8.4 Branch protection** — Operator-side; verify after every onboarding.
