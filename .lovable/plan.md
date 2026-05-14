Document the two shipped Hermes slices as durable project memory so future agents respect the patterns without re-deriving them.

## Files to create

### 1. `mem/features/worker-reliability.md` (Slice 1 — heartbeat/reclaim/retry caps)

Frontmatter: `type: feature`, `name: worker-reliability`, description: "Heartbeat + reclaim + retry caps for overnight jobs and night shifts".

Body covers:
- Tables that carry `heartbeat_at`, `attempts`, `max_retries`, `last_error`: `roadmap_phase_overnight_runs`, `night_shifts`. New jobs of the same shape MUST follow.
- `overnight-phase-runner` contract: bump `attempts` on pickup, heartbeat every 30s while `status='running'`, on failure requeue until `attempts >= max_retries` then set `status='auto_blocked'` with `last_error`.
- `night-agent/open` heartbeats per audited candidate.
- Reclaim path: `public.reclaim_stale_night_jobs(_stale_minutes int)` reverts `running` rows with stale heartbeat to `queued` (or `auto_blocked` if cap hit). Called by `sentinel-tick` every tick — do not call from the runner.
- Sentinel finding `night_jobs_stalled` (medium) fires on reclaimed rows.
- Anti-patterns: silent catch in the runner, skipping `attempts` bump, hand-resetting `auto_blocked` rows without recording why.

### 2. `mem/features/platform-allowlist.md` (Slice 4 — default-deny allowlists)

Frontmatter: `type: feature`, `name: platform-allowlist`, description: "Default-deny allowlist gating Telegram, Companion, Rork TTS".

Body covers:
- Tables: `platform_allowlist (platform, principal, note, …)` unique on `(platform, principal)`, plus `platform_allowlist_audit` written by trigger.
- Helper: `public.is_principal_allowed(_platform text, _principal text) → boolean`. Default-deny — empty allowlist means nobody gets in.
- Gated edge functions: `telegram-webhook` (chat_id), `companion-cloud-chat` (operator email after JWT), `gemini-tts` (operator email after JWT). Any new external-facing function MUST gate on this helper before doing work.
- Rejection path: log via `withLogger` with `__classified_error: 'allowlist_reject'` so logger meta override classifies the row.
- Sentinel: `allowlist_rejects` finding fires at >50/24h per platform.
- Seeded principals: `chris.jaisingh@me.com` for `companion_web` + `rork`. Telegram chat_id must be inserted manually before the bot will reply.
- Admin UI: `/admin` allowlist panel (operator-only RLS) — use it instead of raw SQL where possible.
- Anti-patterns: bypassing the helper "just for diagnostics", storing principals on `profiles`, removing audit trigger.

## Index update

Append to `mem/index.md` under `## Memories`:

```
- [Worker reliability](mem://features/worker-reliability) — heartbeat/attempts/max_retries on roadmap_phase_overnight_runs + night_shifts; reclaim_stale_night_jobs called from sentinel-tick
- [Platform allowlist](mem://features/platform-allowlist) — default-deny is_principal_allowed() gating telegram-webhook, companion-cloud-chat, gemini-tts; allowlist_rejects sentinel >50/24h
```

Preserve every existing line in `mem/index.md` (write-tool replaces full file).

## Out of scope

- Slices 2 (delta-lint) and 3 (companion session auto-resume) — not yet shipped, no memory yet.
- Skills framework — `AGENTS.md` already documents it; no separate memory entry needed.
- Code changes — memory only.