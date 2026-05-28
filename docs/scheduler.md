# Global Scheduling Substrate (W8.1)

One scheduler in Core that any module (Core + FM1–FM12) enqueues against. **Substrate, not a brain** — Core dispatches by `kind`; it never decides what to schedule.

## Tables

| Table | Purpose |
|---|---|
| `scheduled_jobs` | The queue. `UNIQUE (owning_module, dedupe_key)`. RLS operator-only. Realtime. |
| `scheduled_job_events` | Append-only audit on every state change (trigger `log_scheduled_job_event`). |
| `module_endpoints` | Per-FM callback URL for remote dispatch. |
| `external_contacts` | Non-tenant clients/prospects (subject of reminders). |
| `scheduler_kind_catalog` | Free-form catalog of kinds; `handler_mode = local | remote`. |

## Edge functions

| Function | Auth | Purpose |
|---|---|---|
| `scheduler-enqueue` | operator JWT OR `x-awip-service-token` | Idempotent enqueue. Returns `{id, status, dedupe_key, created}`. |
| `scheduler-tick` | `pg_cron` (1-min) via service token | Claims due jobs (`claim_scheduled_jobs` RPC), dispatches local or remote, retries with backoff. |
| `scheduler-register-endpoint` | operator JWT OR `x-awip-service-token` | FM (or operator) registers/updates callback URL. |

## Dispatch — Hybrid (C)

1. `scheduler-tick` resolves handler by `kind`:
   - **Local**: `LOCAL_HANDLERS[kind]` in `supabase/functions/_shared/scheduler-handlers.ts`.
   - **Remote**: POST to `module_endpoints[owning_module].callback_url`.
2. Remote dispatch shape:
   ```
   Headers:
     x-awip-service-token: <module token>     (signed via module_service_tokens)
     Idempotency-Key: <job.id>:<attempt>
   Body:
     { kind, payload, tenant_id, subject_type, subject_id, attempt, deadline_at }
   Replies:
     200 { status: 'done', result? }
     409 { status: 'duplicate' }           → treated as done
     5xx                                   → retryable until max_retries
     4xx                                   → terminal (DLQ)
   ```

## Rules (enforced)

- **FM tenant scope**: `enforce_fm_tenant_scope` trigger rejects rows where `owning_module != 'awip_core'` and `tenant_id IS NULL`.
- **Idempotency**: re-enqueue with same `(owning_module, dedupe_key)` returns existing job id.
- **Audit**: every INSERT/UPDATE writes a row to `scheduled_job_events`.
- **No routing in Core**: `scheduler-tick` does only `HANDLERS[kind]` lookup or `module_endpoints` lookup — never branches on tenant/KR/capability.

## Sentinel checks

| Kind | Severity | Trigger |
|---|---|---|
| `scheduled_jobs_stuck` | medium/high | `running` >10min OR `pending` with `run_at < now()-5min` |
| `scheduler_dlq_growth` | high/critical | >20 `failed` jobs in last 24h |
| `module_endpoint_silent` | medium | FM module has pending jobs but no successful dispatch in >7d |
| `module_endpoint_red` | high | `last_dispatch_err_at > last_dispatch_ok_at` for >1h with ≥3 attempts |

## Runbooks

### stuck-jobs
If `scheduled_jobs_stuck` fires: check `automation_runs.job='scheduler-tick'` for recent errors. If pg_cron is silent, re-enable via `cron.alter_job`. If a single job is wedged in `running`, manually `UPDATE scheduled_jobs SET status='failed' WHERE id=…` so it goes through the DLQ path.

### dlq
Inspect `scheduled_job_events WHERE job_id IN (...)`. Most common causes: handler regression, malformed payload, expired module token.

### endpoint-silent / endpoint-red
Confirm the FM module is still alive (`module_heartbeats`). If silent, re-issue token + re-register callback via `scheduler-register-endpoint`. If red, check the FM's own logs — the URL is responding with 4xx/5xx.

## FM module registration

A new FM project, holding a per-module service token (see `mem://features/module-contracts`), registers once:

```bash
curl -X POST https://<project>.functions.supabase.co/scheduler-register-endpoint \
  -H "x-awip-service-token: $FM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"callback_url":"https://fm1.example.com/awip/scheduler-callback"}'
```

After that, any `scheduler-enqueue` call with `owning_module: 'fm1'` and `kind: 'fm1.something'` will be dispatched to that URL.

## Out of scope (v1)

- Email/SMS delivery rails (Telegram + operator inbox only).
- Migration of the existing 19 `scheduled-*` pg_cron jobs — kept on the existing rail.
- Client self-service reminder portal.
- DAGs / fan-out / workflow chaining.
- Timezone-aware recurrence (UTC only).
- FM1–FM12 callback handler implementations (each FM project ships its own).
