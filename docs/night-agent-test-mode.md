# Night Agent — admin `/open` test mode

Read-only dry-run of the Night Agent open shift logic. Returns the resolved
schedule gates and a per-candidate preview of what `/open` would do **right now**,
without writing any shift, observation, or proposal.

## Request

```
POST /functions/v1/night-agent/open?test=1
Authorization: Bearer <operator session JWT — must carry the 'admin' role>
```

Aliases: `?dryRun=1`, or path `/open/test`. Optional `?at=<ISO timestamp>` evaluates
the gates against an arbitrary moment instead of `now()`.

The cron service token (`x-awip-service-token`) is **rejected** with `403` — gate
verification is a human action and must be tied to an operator identity.

## Response — would-run example

```json
{
  "test_mode": true,
  "actor_id": "8f3c1c2e-1d8b-4a35-9c1f-7e1d6c8a4b22",
  "triggered_at": "2026-05-08T23:14:07.512Z",
  "gates": {
    "timezone": "Europe/Berlin",
    "window": "22:00-06:00",
    "local_date": "2026-05-09",
    "local_time": "01:14",
    "enabled": true,
    "in_window": true,
    "blackout_hit": false,
    "allowed_kinds": ["general", "auth", "roadmap", "jobs"],
    "blackout_dates": ["2026-12-24", "2026-12-31"]
  },
  "would_open_shift": true,
  "skip_reasons": [],
  "candidates_total": 3,
  "would_audit": 2,
  "would_skip": 1,
  "jobs": [
    {
      "id": "a1b2c3d4-0000-4000-8000-000000000001",
      "short_num": 142,
      "title": "Tighten roadmap finding redaction copy",
      "risk": "med",
      "phase": "roadmap",
      "suite": "roadmap",
      "would_audit": true,
      "skip_reasons": []
    },
    {
      "id": "a1b2c3d4-0000-4000-8000-000000000002",
      "short_num": 143,
      "title": "Refresh jobs panel empty state",
      "risk": "low",
      "phase": "jobs",
      "suite": "jobs",
      "would_audit": true,
      "skip_reasons": []
    },
    {
      "id": "a1b2c3d4-0000-4000-8000-000000000003",
      "short_num": 144,
      "title": "Audit Stripe payment retry path",
      "risk": "high",
      "phase": "general",
      "suite": "general",
      "would_audit": false,
      "skip_reasons": [
        "risk=high (keyword match (security/auth/payment/delete/migration/prod))"
      ]
    }
  ],
  "note": "read-only · no shift, observation, or proposal was written"
}
```

## Response — would-skip example (outside window + blackout)

```json
{
  "test_mode": true,
  "actor_id": "8f3c1c2e-1d8b-4a35-9c1f-7e1d6c8a4b22",
  "triggered_at": "2026-12-24T15:02:00.000Z",
  "gates": {
    "timezone": "Europe/Berlin",
    "window": "22:00-06:00",
    "local_date": "2026-12-24",
    "local_time": "16:02",
    "enabled": true,
    "in_window": false,
    "blackout_hit": true,
    "allowed_kinds": ["general", "auth", "roadmap", "jobs"],
    "blackout_dates": ["2026-12-24", "2026-12-31"]
  },
  "would_open_shift": false,
  "skip_reasons": ["blackout_date", "outside_window"],
  "candidates_total": 0,
  "would_audit": 0,
  "would_skip": 0,
  "jobs": [],
  "note": "read-only · no shift, observation, or proposal was written"
}
```

## Field reference

### Top level

| Field | Type | Notes |
|---|---|---|
| `test_mode` | `boolean` | Always `true` for this endpoint. |
| `actor_id` | `uuid` | `sub` claim from the operator JWT. |
| `triggered_at` | `ISO timestamp` | The moment evaluated (echoes `?at=` if given). |
| `would_open_shift` | `boolean` | `true` iff `skip_reasons` is empty. |
| `skip_reasons` | `string[]` | Subset of `night_agent_disabled`, `blackout_date`, `outside_window`, `no_allowed_kinds`. |
| `candidates_total` | `number` | Eligible `discussion_actions` rows (open · `night_eligible=true` · not promoted). |
| `would_audit` | `number` | Jobs that would proceed through the 5-step audit. |
| `would_skip` | `number` | Jobs filtered by `risk=high` or disallowed `phase`. |
| `jobs` | `Job[]` | Per-candidate preview, capped at `MAX_JOBS_PER_SHIFT` (50). |
| `note` | `string` | Always reminds the caller nothing was written. |

### `gates`

| Field | Type | Notes |
|---|---|---|
| `timezone` | `string` | IANA zone from `memory_settings.night_timezone`. |
| `window` | `string` | `"HH:MM-HH:MM"`; wraps midnight if end ≤ start. |
| `local_date` | `YYYY-MM-DD` | `triggered_at` projected into the configured zone. |
| `local_time` | `HH:MM` | Same projection, used for window check. |
| `enabled` | `boolean` | `memory_settings.night_agent_enabled`. |
| `in_window` | `boolean` | `local_time` falls inside `window`. |
| `blackout_hit` | `boolean` | `local_date` is in `blackout_dates`. |
| `allowed_kinds` | `string[]` | Permitted phases (`general`, `auth`, `roadmap`, `copilot`, `jobs`). |
| `blackout_dates` | `string[]` | Configured blackout `YYYY-MM-DD` list. |

### `Job`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | `discussion_actions.id`. |
| `short_num` | `number` | Human-readable handle (e.g. `#142`). |
| `title` | `string` | Job title used for phase inference. |
| `risk` | `"low" \| "med" \| "high"` | From `classifyJob` (keywords + priority). |
| `phase` / `suite` | `string` | Inferred from title; defaults to `general`. |
| `would_audit` | `boolean` | `true` if the job would enter the 5-step audit. |
| `skip_reasons` | `string[]` | Empty when `would_audit` is `true`. |
