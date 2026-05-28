# Module scaffold

Drop these files into each new module project (Discovery AI, Control Plane, Occupancy Module, Connector Hub) once you create it in Lovable. The scaffold is intentionally tiny — README + manifest + one edge function that registers the module's capabilities with Core on call.

## Files

| File | Purpose |
|---|---|
| `README.md.template` | Per-module README, mentions parent (Core), required secrets, how to register |
| `capabilities.json` | The capabilities this module owns. Edit before first register. |
| `register/index.ts` | Edge function that POSTs each entry in `capabilities.json` to Core's `/capabilities/register`. Trigger by curl after deploy, or wire into a CI step. |

## Required project secrets in each module project

- `AWIP_SERVICE_TOKEN` — same value as in Core
- `AWIP_CORE_URL` — e.g. `https://<core-project-ref>.supabase.co`

## Registering after deploy

```bash
curl -X POST "https://<module-ref>.supabase.co/functions/v1/register" \
  -H "Authorization: Bearer <module-anon-key>"
```

The function reads `capabilities.json` (bundled at deploy time), forwards each entry to Core, and returns the per-capability result.

## Reference module

**FM1 Stakeholder Intelligence** is the worked example. See its 3 seeded capabilities in `public.capabilities WHERE owning_module='fm1'` and the rules in `mem://features/fm1-stakeholder-intelligence`. New FMs should follow the same id convention (`fm{N}_<surface>_<capability>`, underscores only — dots are rejected by `validateRegisterInput`) and start at `status='planned'`, `version='0.1.0'`.

## Scheduling (W8.1)

Modules do **not** ship their own pg_cron. Use Core's Global Scheduling Substrate:

1. **Register your callback** once (idempotent):

   ```bash
   curl -X POST "$AWIP_CORE_URL/functions/v1/scheduler-register-endpoint" \
     -H "x-awip-service-token: $FM_SERVICE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"callback_url":"https://<module-ref>.functions.supabase.co/scheduler-callback"}'
   ```

2. **Enqueue jobs** from any code path that holds the per-module service token. `tenant_id` is **mandatory** for non-`awip_core` jobs (enforced by `enforce_fm_tenant_scope` trigger):

   ```bash
   curl -X POST "$AWIP_CORE_URL/functions/v1/scheduler-enqueue" \
     -H "x-awip-service-token: $FM_SERVICE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "kind":"fm{N}.<surface>",
       "owning_module":"fm{N}",
       "tenant_id":"<uuid>",
       "dedupe_key":"<stable key>",
       "run_at":"2026-06-01T09:00:00Z",
       "payload":{...}
     }'
   ```

3. **Implement `scheduler-callback`** in your module. Core POSTs with `x-awip-service-token`, `Idempotency-Key: <job.id>:<attempt>`, and body `{ kind, payload, tenant_id, subject_type, subject_id, attempt, deadline_at }`. Reply:
   - `200 { status: "done", result? }` — success
   - `409 { status: "duplicate" }` — already processed, treated as done
   - `5xx` — retryable up to `max_retries`
   - `4xx` — terminal (DLQ)

See `docs/scheduler.md` and `supabase/functions/_shared/contracts/scheduler.ts` for the full contract.
