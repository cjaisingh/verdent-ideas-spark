---
name: platform-allowlist
description: Default-deny allowlist gating Telegram, Companion, Rork TTS (Hermes slice 4)
type: feature
---

Default-deny gate for every external-facing edge function. Empty allowlist means nobody gets in — no implicit "operator can always reach it" fallback.

## Schema

- `platform_allowlist (id, platform text, principal text, note text, created_at)` — unique on `(platform, principal)`. Operator-only RLS.
- `platform_allowlist_audit` — written by trigger on insert/update/delete. Never disable the trigger.

## Helper

```sql
public.is_principal_allowed(_platform text, _principal text) returns boolean
```

Returns `false` if the row is absent. Use it after JWT/webhook validation, before doing any work.

## Gated functions

| Function | Platform | Principal |
|---|---|---|
| `telegram-webhook` | `telegram` | `chat_id` (string) |
| `companion-cloud-chat` | `companion_web` | operator email from JWT |
| `gemini-tts` | `rork` | operator email from JWT |

Any new external-facing function MUST gate on `is_principal_allowed` before touching the database, calling AI, or returning data.

## Rejection logging

Reject path logs through `withLogger` with meta override `__classified_error: 'allowlist_reject'`. Logger honours the override and tags the `api_call_logs` row accordingly.

## Sentinel

`allowlist_rejects` (medium) fires when any single platform exceeds 50 rejects in 24h. Indicates either a misconfigured caller or an attack.

## Seeded principals

- `chris.jaisingh@me.com` for `companion_web` and `rork` (seeded by migration).
- Telegram `chat_id` must be inserted manually before the bot will reply — no auto-seed.

## Admin UI

`/admin` allowlist panel (operator-only RLS) is the supported way to add/remove principals. Use it instead of raw SQL when possible so the audit row carries context.

## Anti-patterns

- Bypassing the helper "just for diagnostics" — there is no diagnostic mode.
- Storing principals on `profiles` or hard-coding them in edge functions.
- Removing or disabling the `platform_allowlist_audit` trigger.
- Adding a new external-facing function without an allowlist gate.
