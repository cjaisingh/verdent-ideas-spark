## Why every walkthrough shows 10/10

Each nightly run probes:

- 2 awip-api endpoints
- 5 edge function OPTIONS/GET probes
- 3 capability self-tests

= **10 checks**. The 7 UI route probes (`/`, `/auth`, `/roadmap`, `/overnight`, `/morning-review`, `/audits`, `/companion`) are only included when the function receives a `preview_origin` in the POST body. The cron job sends `{"source":"cron"}` — no origin — so `uiRouteProbes("")` returns `[]` and UI routes are silently skipped. That's been the case since day 1; the AWIP secret rotation didn't affect this.

Separately: cron.job_run_details says today's 02:15 UTC run succeeded, but no row exists in `walkthrough_runs` for 19 May. The edge function almost certainly 401'd before insert (token rotation timing). Need to confirm from logs and re-run once for today.

## Plan

### 1. Make UI route probes run under cron

- Add a new edge-function env var `WALKTHROUGH_PREVIEW_ORIGIN` (default to the published/preview origin, e.g. `https://id-preview--c58aeaea-93be-4b64-bb57-aeef50ab6dcd.lovable.app`).
- In `supabase/functions/app-walkthrough/index.ts`, fall back to `Deno.env.get("WALKTHROUGH_PREVIEW_ORIGIN")` when the request body doesn't supply one.
- Result: every nightly probes 17 targets (10 backend + 7 UI) instead of 10.

### 2. Backfill today's missed run

- Manually invoke `app-walkthrough` once now so 19 May has a row.
- Confirm next 02:15 UTC produces a fresh row.

### 3. Verify

- After deploy, trigger one manual run from `/walkthrough` → expect `17/17 passed` (or surface real UI failures).
- Confirm `cron.job_run_details` for `scheduled-app-walkthrough` and `walkthrough_runs` stay in lockstep going forward.

### Out of scope

- Retention / pagination of the runs list (currently shows last 50, DB has 13).
- Adding more probes beyond the existing UI route set — can be a follow-up once we see which UI routes actually pass under cron.

## Technical notes

- `supabase/functions/app-walkthrough/probes.ts` `uiRouteProbes(previewOrigin)` already returns `[]` on empty string — no change needed there.
- Env var route avoids hardcoding the preview URL in source; user can override per environment.
- No DB migration required.
