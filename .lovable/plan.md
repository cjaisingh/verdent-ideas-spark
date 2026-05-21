## Why I didn't see the alerts

I have no live channel to Telegram or `alert_log`. I only see what's in the prompt window when you message me. Last turn I declared "all 4 phase runs done" based on my own `curl` calls (which carried the service token explicitly). I never re-checked whether the **cron-driven** invocations succeeded after that. They didn't — and that's what Caprica has been yelling about. I'll stop claiming "done" off manual curls alone.

## What's actually wrong

Pulled from `alert_log` (last hour):

1. **"Run night agent now" is not an error.** HTTP 200, body `{"skipped":true,"reason":"outside_window"}`. It's 07:50 UTC, window is 22:00–06:00. The toast just dumps the JSON so it looks scary. No force/override path exists on the button.

2. **`overnight-phase-runner-15m` cron → 401, every 15 min.** Messages alternate between `missing x-service-token header` and `service token mismatch`. The token in `app_secrets.AWIP_SERVICE_TOKEN` (72 chars, updated 2026-05-19) is not the value pg_cron is sending in the header, or not the value the edge runtime env has. Same root cause hitting `night-agent-close`.

3. **`contract_envelope_rejected` for phase-5/6/6b/7.** The model is returning `contract_acknowledged: "phase-5"` (the phase key) instead of the binding's `declaredBy` or `store` string. My prompt tweak last turn wasn't enough — runner rejects, alert fires. One run (`phase-5 50c46…2653c`) also came back with the envelope fields entirely missing (`Required`).

4. **Rolled-up alert:** `cron_auth_failures_burst` (10 in 1h across 2 jobs) — symptom of #2, not separate.

## Plan

### A. Stop the toast-as-error illusion (small)
`src/components/night/NightBacklogTable.tsx` — when response JSON has `skipped: true`, render an info-tone toast `"Night agent skipped — outside window (22:00–06:00 UTC)"` instead of dumping raw JSON. Add a `Force run` secondary button that POSTs `{ force: true }` so the operator has a deliberate override.

### B. Honour `force: true` in `night-agent/open`
`supabase/functions/night-agent/open.ts` — if body has `force === true` and caller has operator JWT, bypass the window/blackout gates (still respects `enabled`). Log it as `night_observations.kind = 'forced_open'`.

### C. Realign service token (no code, ops step inside this plan)
Run `secrets-health-check?sync=env-to-db` then re-deploy `overnight-phase-runner` + `night-agent` so edge runtime picks up the env value. Verify by reading `alert_log` 15 min later — `auth_failed` count for `overnight-phase-runner-15m` should be 0. Do **not** declare success until that read confirms it.

### D. Fix the contract envelope prompt
`supabase/functions/overnight-phase-runner/index.ts` — the system prompt currently says "use the value above for `contract_acknowledged`". Replace with a literal interpolation block that shows the model the **exact** string it must echo, plus a JSON schema fragment, plus one worked example per phase. Also: if the AI returns the phase key (common failure), accept it on a single retry where we re-prompt with an even stricter "ONLY this string: `<value>`" instruction before giving up.

### E. Verification (mandatory before I say "done")
- `select count(*) from alert_log where created_at > now() - interval '20 min' and reason in ('auth_failed','contract_envelope_rejected')` → must be 0
- Tonight's 22:00 UTC cron tick — read `roadmap_phase_overnight_runs` for `dated_for = 2026-05-22`, all 4 must reach `status='done'` without operator intervention
- Operator UI: click "Run agent now" outside window → friendly skipped toast; click "Force run" → opens a shift row

## Technical notes

- `app_secrets` table has columns `key, value, updated_at` (not `name`).
- The runner's envelope check lives in `supabase/functions/_shared/contracts/phase-contract-map.ts → rejectEnvelope`. The bindings expect either `declaredBy` (e.g. `"awip.phase5.resolver"`) or `store` (e.g. `"public.canonical_tenant_resolutions"`). Returning the bare phase key like `"phase-5"` is rejected by design — fix is in the prompt, not the check.
- Force-run path must remain operator-JWT-gated; service token alone shouldn't be enough to bypass the window (that's what cron uses and we don't want cron firing outside the window).
- No DB migration required.
