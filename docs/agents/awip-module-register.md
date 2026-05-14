---
name: awip-module-register
description: Correct end-to-end flow for registering a new AWIP module or capability with Core. Load this skill when adding a new module project, declaring a new capability, or promoting a capability between status tiers.
---

# Skill: awip-module-register

Modules self-register with Core by calling `POST /capabilities/register`. Core upserts the manifest row and emits a `capability_events` row. Do not bypass this path with a direct DB insert — consumers will miss the event.

## When to use this skill

- Standing up a new module project (Discovery AI, Occupancy Module, Connector Hub, …).
- Declaring a new capability inside an existing module.
- Promoting a capability (`planned → experimental → available → deprecated`).
- Bumping a capability version or changing `owning_module`.

## The flow

### 1. Decide where the capability belongs

Read `docs/modules.md`. Pick the owning module. If none fits, the capability probably belongs in a new module project — do not just attach it to `awip_core`.

### 2. Declare it in the module's `capabilities.json`

Use `docs/module-scaffold/capabilities.json` as the template:

```json
{
  "id": "desk_utilisation_measurement",
  "name": "Desk utilisation measurement",
  "status": "planned",
  "version": "0.1.0",
  "owning_module": "occupancy_module",
  "inputs_required": [{ "kind": "sensor_feed" }],
  "outputs_provided": [{ "metric": "desk_occupancy_pct" }]
}
```

### 3. Call Core's register endpoint

From the module project's `register` edge function (template at `docs/module-scaffold/register/index.ts`):

```ts
await fetch(`${AWIP_CORE_URL}/functions/v1/awip-api/capabilities/register`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-awip-service-token": Deno.env.get("AWIP_SERVICE_TOKEN")!,
    "Idempotency-Key": `register-${capability.id}-${capability.version}`,
  },
  body: JSON.stringify(capability),
});
```

Required secrets in the module project:
- `AWIP_CORE_URL` — `https://<core-project-ref>.supabase.co`
- `AWIP_SERVICE_TOKEN` — same value as in Core

### 4. Verify the event landed

After registration, confirm a `capability_events` row exists for this capability with the expected `event_type` (`registered`, `status_changed`, `version_bumped`, …). The Control Plane's live feed should show it within a second.

```sql
select * from capability_events
where capability_id = 'desk_utilisation_measurement'
order by created_at desc limit 5;
```

### 5. Update the manifest doc

Edit `docs/modules.md` — add the capability to the owning module's table with its current status. Bump `CHANGELOG.md` if the change is operator-visible.

## Anti-patterns

- ❌ Inserting directly into `capabilities` from a migration. Use the endpoint so the event fires.
- ❌ Reusing an `Idempotency-Key` across version bumps. Include the version in the key.
- ❌ Promoting `experimental → available` without satisfying the promotion gates — see `docs/capability-promotion.md` and call `POST /capabilities/:id/promote` instead of editing `status` directly.
- ❌ Adding routing logic ("if this capability is registered, kick off X") to Core. That belongs in Control Plane.

## Related rules

This skill assumes the five rules in [`awip-core-rules`](./awip-core-rules.md) — load that skill alongside this one if you are also touching the contract API.
