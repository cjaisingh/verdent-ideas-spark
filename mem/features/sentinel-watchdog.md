---
name: Sentinel watchdog (out-of-band)
description: Independent 15-min watchdog for sentinel-tick — pages Telegram directly when sentinel itself goes silent; no shared secret with sentinel-tick
type: feature
---

**Why it exists**: sentinel-tick runs ~22 silence detectors but cannot detect its own silence. On 2026-06-01 a stale `AWIP_SERVICE_TOKEN` 401'd sentinel-tick itself, silently disabling every alert layered on top of it. This is the watchdog-of-the-watchdog.

**Design — deliberate independence**:
- Separate cron `scheduled-sentinel-watchdog` at minutes 7/22/37/52 (offset from sentinel-tick at 0/15/30/45).
- Edge fn `sentinel-watchdog` is **unauthenticated by design** — idempotent (heartbeat every tick, hour-bucket dedupe + 6h cooldown on alerts). Worst-case abuse is one redundant Telegram per 6h, which the operator wants anyway.
- Calls the Telegram connector gateway **directly** (no `telegram-send` middleman), using `LOVABLE_API_KEY` + `TELEGRAM_API_KEY` (both connector-managed, both independent of `AWIP_SERVICE_TOKEN`).
- No `x-service-token`, no `x-awip-watchdog-token`, no shared secret with the thing it watches.

**Trigger logic** (`decide()` in `supabase/functions/sentinel-watchdog/index.ts`):
- `healthy` — last successful `automation_runs.job='scheduled-sentinel-tick' status='ok'` within 30 min.
- `stale` — > 30 min ago → alert (unless deduped).
- `never_ran` — no successful run in 24h → alert (unless deduped).
- `deduped` — same hour-bucket key (`sentinel-silent::stale::YYYY-MM-DDTHH` or `::never::…`) within 6h cooldown.

**Heartbeat table**: `public.sentinel_watchdog_runs` (operator-only SELECT, service_role full). Every tick writes a row; alert rows carry `last_alert_key` for dedupe lookup.

**Alert body** includes the top 5 failing crons (last 24h, 4xx/5xx) so the operator gets immediate triage context. Fix hint: rotate `AWIP_SERVICE_TOKEN` + re-register affected crons.

**Self-watching**: registered in `observability_registry` (surface_id=`scheduled-sentinel-watchdog`, cadence 15 min) so `observability_missing_watcher` flags if the watchdog itself ever goes silent. Bounded at 2 layers — no infinite turtles.

**Test**: `supabase/functions/sentinel-watchdog/decide_test.ts` covers healthy / stale / never-ran / deduped / cooldown-elapsed.

**Manual smoke test**: `POST /sentinel-watchdog?trigger=manual` (no auth). Confirmed working 2026-06-01 against the live sentinel-tick outage — alerted=true, top_failing_jobs listed scheduled-code-review/record-test-run/postmortem-generate/night-agent-close/lessons-daily-synth all 401.
