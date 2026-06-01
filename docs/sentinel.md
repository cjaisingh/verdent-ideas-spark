# Sentinel Agent (W3)

Continuous 15-min watcher. Runs via `scheduled-sentinel-tick` cron (`*/15 * * * *`)
and writes to `public.sentinel_findings` (unique on `dedupe_key`).

## Checks (`supabase/functions/sentinel-tick/checks.ts`)

| Kind            | Trigger                                                            | Default severity |
| --------------- | ------------------------------------------------------------------ | ---------------- |
| `cron_silence`  | Any tracked job silent > 2× cadence                                | high / medium / low (by cadence) |
| `five_xx_spike` | ≥ 5 5xx in last 15 min in `edge_request_logs`                      | high (≥20 → critical) |
| `secret_age`    | `app_secrets.updated_at` older than 90 days                        | low |
| `role_grant`    | New `role_change_audit` row granting `admin` in last 15 min        | high |

## Behaviour

- **Dedupe** by `dedupe_key`; repeats bump `last_seen_at` and `severity` only.
- **Auto-resolve**: open findings whose `dedupe_key` did not re-fire are closed (`status='resolved'`, `resolved_at=now()`), except `role_grant` (always manual).
- **Alerts**: only **new** high/critical candidates dispatch via `dispatchAlert(reason='high_finding')`.
- **Roll-up**: Morning Review pulls open findings (medium+) into its `open_findings` array.

## UI

- `SentinelStatusStrip` rendered in `Roadmap.tsx` above `AutomationPanel`.
- Pill colour: green / amber / red based on worst open severity.

## Testing

```bash
deno test supabase/functions/sentinel-tick/checks_test.ts
```

## Out-of-band watchdog

`sentinel-tick` cannot detect its own silence — every check it runs depends on the same edge runtime + service token. The **`sentinel-watchdog`** edge fn is the watcher-of-the-watcher:

- Cron: `scheduled-sentinel-watchdog` at minutes `7,22,37,52` (offset from sentinel-tick).
- Auth: **none** — idempotent by design (hour-bucket dedupe + 6h cooldown).
- Telegram path: **direct connector gateway** (`LOVABLE_API_KEY` + `TELEGRAM_API_KEY`), bypassing `telegram-send` and `AWIP_SERVICE_TOKEN` entirely.
- Heartbeat: `public.sentinel_watchdog_runs` (operator-only). Alerts after sentinel-tick has been silent > 30 min.
- Self-watched: registered in `observability_registry` so `observability_missing_watcher` fires if it ever goes silent. Bounded at 2 layers.
- Manual smoke test: `POST /sentinel-watchdog?trigger=manual`.

Tests: `supabase/functions/sentinel-watchdog/decide_test.ts`.
