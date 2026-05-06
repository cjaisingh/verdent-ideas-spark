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
