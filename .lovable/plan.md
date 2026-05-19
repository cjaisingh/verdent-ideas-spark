## Findings

- **The voice page is red because of stale success timestamps, not current failures.**
- `/admin/voice-health` marks a leg **red** when either:
  - error rate is above 10% in the last hour, or
  - the **last successful call is older than 60 minutes**.
- Current backend data for the last 60 minutes shows:
  - `gemini-tts`: **0 calls, 0 errors**
  - `companion-cloud-chat`: **0 calls, 0 errors**
  - `telegram-send-voice`: **0 calls, 0 errors**
- Latest successful calls are old enough to trip the UI red rule:
  - `companion-cloud-chat`: **2026-05-13 06:15 UTC**
  - `gemini-tts`: **2026-05-18 02:15 UTC**
  - `telegram-send-voice`: **2026-05-18 15:35 UTC**
- There are **no current `voice_pipeline_red` sentinel findings**, so the backend watchdog is not currently treating voice as failed.

## What the Telegram messages mean

These are **separate from voice health**:

- `sentinel-tick unauthorized`
- `overnight-phase-runner-15m 401 — service token mismatch`

Those alerts indicate **cron/service-token authentication failures** on scheduled jobs, not a voice pipeline outage.

## Plan

1. **Separate inactive from broken on `/admin/voice-health`**
   - Change the page so **no traffic in the last hour** shows as **idle/stale**, not red.
   - Keep **red** for real recent failures or a clearly broken end-to-end path.

2. **Align the page with sentinel semantics**
   - Make sure the dashboard and sentinel use the same rule set, so UI red and backend high-severity findings mean the same thing.
   - Optionally add a distinct **stale** state if you want dormant-but-configured pipelines called out without implying an outage.

3. **Investigate the Telegram auth failures separately**
   - Trace the scheduler/auth path for `sentinel-tick` and `overnight-phase-runner-15m`.
   - Verify the expected service-token header name/value and the current scheduled caller configuration.
   - Fix the mismatch so Telegram stops receiving false auth-failure noise.

## Technical details

- UI logic: `src/pages/VoiceHealth.tsx`
- Sentinel check: `supabase/functions/sentinel-tick/checks.ts`
- Sentinel auth path: `supabase/functions/sentinel-tick/index.ts`
- The current mismatch is:
  - **UI:** stale success can produce **red** even with zero recent requests
  - **Sentinel:** `voice_pipeline_red` only fires when there are recent requests with no success, or enough recent 5xx volume

## Recommended implementation order

1. Fix the **Telegram cron auth noise** so alerts are trustworthy.
2. Fix the **voice health status semantics** so red means failure, not dormancy.
3. Re-test with one manual `/voice-setup` run to confirm the page returns to green on fresh success.