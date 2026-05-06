# AWIP Modules

AWIP is a constellation of Lovable projects. Each module is its own project that **registers itself with Core** via `POST /capabilities/register` and stores `AWIP_SERVICE_TOKEN` as a project secret to call Core's contract API.

This file lists the planned modules and which capabilities each one owns in the manifest (`capabilities.owning_module`).

## Modules

### `awip_core` — this project
Owns the OKR tree, the manifest, the event streams, and (by decision) the operator channel: Telegram webhook/send, message routing, approval queue, and voice transcription. Kept in-process to avoid an extra service hop for the bot.

| Capability | Status |
|---|---|
| `okr_authoring` | available |
| `operator_channel.telegram` | available |
| `operator_channel.voice_transcription` | available (Gemini 2.5 Flash) |

### `discovery_ai` — separate Lovable project
Drafts OKR trees with clients, then hands them to Core via `POST /okr/ingest`. Reads `GET /capabilities` during drafting to constrain to what's available.

| Capability | Status |
|---|---|
| `engagement_kickoff_capture` | available |

### `control_plane` — currently embedded at `/control-plane`
Read-only consumer of `okr_node_events` + `capability_events` + the demand aggregate. Will move to its own Lovable project once the first acting module ships.

| Capability | Status |
|---|---|
| `cost_per_seat_attribution` | planned |
| `headcount_forecast` | planned |
| `space_demand_modelling` | planned |

### `occupancy_module` — first acting module (planned)
Strongest demand signal in the manifest. Build target after Discovery AI.

| Capability | Status |
|---|---|
| `desk_utilisation_measurement` | planned |
| `meeting_room_utilisation` | planned |
| `badge_swipe_ingest` | planned |
| `cleaning_demand_signal` | planned |
| `energy_consumption_baseline` | planned |

### `connector_hub` — placeholder owner for shared connectors
Will likely split per-connector (Stripe, sensor feeds, document stores) once any of these graduate.

| Capability | Status |
|---|---|
| `lease_summary_extraction` | experimental |
| `document_qa` | planned |

## How a module registers itself

Each module project should call this on first deploy (and whenever its manifest changes). The shared scaffold lives at [`docs/module-scaffold/`](./module-scaffold/).

```ts
await fetch(`${AWIP_CORE_URL}/functions/v1/awip-api/capabilities/register`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-awip-service-token": Deno.env.get("AWIP_SERVICE_TOKEN")!,
  },
  body: JSON.stringify({
    id: "desk_utilisation_measurement",
    name: "Desk utilisation measurement",
    status: "available",
    version: "0.1.0",
    owning_module: "occupancy_module",
    inputs_required: [{ kind: "sensor_feed" }],
    outputs_provided: [{ metric: "desk_occupancy_pct" }],
  }),
});
```

Required secrets in each module project:

- `AWIP_SERVICE_TOKEN` — same value as in Core
- `AWIP_CORE_URL` — Core's Supabase URL (`https://<core-project-ref>.supabase.co`)
