# Runbook — Rotate `AWIP_SERVICE_TOKEN`

`AWIP_SERVICE_TOKEN` authenticates 31 cron jobs against the contract API. It is
mirrored across **three** stores; if any two drift apart, jobs silently 401.

| Store | Purpose | Who reads |
|---|---|---|
| Edge function env | Source of truth | Every edge fn that validates the incoming token |
| `public.app_secrets` | Cron payload assembly | 23 cron jobs that call `get_app_secret()` |
| `vault.secrets` | Cron payload assembly | 8 cron jobs that read `vault.decrypted_secrets` |

## When to rotate

- Suspected leak or scheduled rotation (quarterly).
- `secrets-health-check` reports `mismatched` for `AWIP_SERVICE_TOKEN`.
- `cron_auth_failures_burst` or `secrets_health_stale` fires on `sentinel-tick`.

## Procedure

1. **Generate a new token** locally (any 32-byte random base64url string is fine).
2. **Update the edge env**: Lovable Cloud → Secrets → `AWIP_SERVICE_TOKEN`. Save.
3. **Log in to the operator console** in a browser tab.
4. **Open `/admin/secrets-health`**, click **Run check** to confirm `app_secrets`
   and `vault.secrets` now disagree with env.
5. **Click `Sync env → all (db + vault)`** → **Confirm sync all**. The endpoint
   calls `set_awip_service_token` which writes `app_secrets` AND `vault.secrets`
   atomically.
6. **Verify** (within 15 min):
   - `gh_actions_runs` has a new row.
   - `automation_runs` for `scheduled-sentinel-tick` shows `status='ok'`.
   - No new `secrets_health_stale` or `cron_auth_failures_burst` finding in the next hour.

## What the sync button does

```
POST /functions/v1/secrets-health-check?sync=env-to-all
Authorization: Bearer <operator JWT>
```

Modes available on the same endpoint:

| Mode | Writes |
|---|---|
| (none) | Read-only check |
| `?sync=env-to-db` | Overwrites every key in `app_secrets` from env |
| `?sync=env-to-vault` | Overwrites `AWIP_SERVICE_TOKEN` in `vault.secrets` (via `set_awip_service_token`, which also rewrites `app_secrets`) |
| `?sync=env-to-all` | Both of the above in lockstep |

All sync modes require an operator JWT and are blocked when the call is from cron
(authenticated with `SUPABASE_SERVICE_ROLE_KEY`).

## Out-of-band safety net

The watchdog (`sentinel-watchdog`, cron `scheduled-sentinel-watchdog` at
`7,22,37,52 * * * *`) does NOT use `AWIP_SERVICE_TOKEN`. It is unauthenticated by
design and calls the Telegram connector gateway directly. If `sentinel-tick` goes
silent for >30 min, the watchdog fires a Telegram alert regardless of which token
is broken.

## Related

- `mem://features/secret-rotation-safety`
- `mem://features/sentinel-monitoring-coverage`
- `docs/adr/0009-secrets-at-rest.md`
- `docs/runbooks/secrets-mek-rotation.md`
