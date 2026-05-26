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
