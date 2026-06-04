---
name: secret-rotation-safety
description: secrets-health-check sync modes (env-to-db, env-to-vault, env-to-all) for aligning the three AWIP_SERVICE_TOKEN stores; out-of-band watchdog catches lockstep failures
type: feature
---

`AWIP_SERVICE_TOKEN` is mirrored across **three** stores; drift → 31 crons 401.

| Store | Read by |
|---|---|
| Edge env (source of truth) | Every edge fn validating the incoming token |
| `public.app_secrets` (via `get_app_secret`) | 23 cron jobs |
| `vault.secrets` (via `vault.decrypted_secrets`) | 8 cron jobs (gh-actions-watch, code-review, lessons-daily-synth, postmortem-generate, night-agent-close, connections-probe, qa-validate, weekly-code-review) |

**Endpoint** `secrets-health-check`:
- No params → read-only check, returns `mismatches` with first 8 hex of SHA-256 fingerprint per side.
- `?sync=env-to-db` → overwrites every key in `app_secrets` from env via `set_app_secret`.
- `?sync=env-to-vault` → overwrites `AWIP_SERVICE_TOKEN` in `vault.secrets` via `set_awip_service_token` (which atomically rewrites `app_secrets` too).
- `?sync=env-to-all` → both, in lockstep. **Use after rotation.**

All sync modes require an operator JWT; cron path (service-role-key Bearer) is blocked from sync — prevents auto-overwrite of env's source-of-truth role.

**Auth model** `secrets-health-check` authenticates with `SUPABASE_SERVICE_ROLE_KEY` from cron (NOT `AWIP_SERVICE_TOKEN` — that's exactly the secret it's designed to detect drift on). Manual operator calls use Bearer JWT.

**UI** `/admin/secrets-health` exposes Run check + Sync env → db + Sync env → all (db + vault). Each sync requires a two-step confirm.

**Sentinel detectors**:
- `secrets_health_stale` — no `secrets-health-check` ok run in 24h (medium).
- `cron_auth_failures_burst` — ≥5 `automation_runs` with `status_code=401` in 1h across distinct jobs (high).

**Out-of-band safety net** `sentinel-watchdog` (mem://features/sentinel-watchdog) catches lockstep silence where the token failure 401s sentinel-tick itself. Watchdog has no shared secret with the surfaces it watches.

**Runbook** `docs/runbooks/awip-service-token-rotation.md` — 5-step rotation ending at `Sync env → all`.

**Out of scope** Per-cron token isolation (each cron gets a narrowly-scoped token) tracked in plan-footer-ingest under `per_cron_token_isolation`.
