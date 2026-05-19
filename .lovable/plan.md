# Fix token mismatch + close the detection gap

Scope: the token rotation itself, plus the three guardrails that would have caught it within an hour instead of a day. Telegram re-registration and the broader independent-loop diagnosis stay as a separate follow-up.

## 1. Rotate `AWIP_SERVICE_TOKEN` atomically

- Read the current value from `public.app_secrets.AWIP_SERVICE_TOKEN` (the DB-side value all cron jobs already use).
- Use `secrets--update_secret` to push the same value into the edge-function env var `AWIP_SERVICE_TOKEN`.
- Manually re-invoke one representative cron target per family and confirm `200` + a fresh row written:
  - `sentinel-tick` → new `sentinel_findings` row
  - `overnight-phase-runner` → status advance or "nothing to do" 200
  - `tomorrow-plan-refresh` → new `tomorrow_plans` row dated today
  - `scheduled-lessons-daily` → 200 (synth may legitimately produce 0 rows)
- Confirm `automation_runs` shows `ok` for the next natural tick of each.

Out of scope here: vault entry normalisation (handled in the follow-up change together with killing the duplicate read in `scheduled-lessons-daily`).

## 2. Stop `secrets-health-check` self-DoSing  *(item 1 from prior message)*

- Change the cron entry for `secrets-health-check` so the `Authorization` header uses `SUPABASE_SERVICE_ROLE_KEY` (Bearer) instead of `x-service-token: AWIP_SERVICE_TOKEN`.
- Update the edge function to accept service-role auth and skip the operator-JWT path.
- Rationale: the detector for token drift must not authenticate with the very token it's verifying.

## 3. Staleness sentinel on the detector  *(item 3)*

- New sentinel check `secrets_health_stale`: critical finding if `secrets-health-check` has no `ok` row in `automation_runs` within the last 26h.
- Wire into `sentinel-tick`; surface on `/admin/edge-health` and Morning Review.

## 4. Aggregate `auth_failed` sentinel  *(item 4)*

- New sentinel check `cron_auth_failures_burst`: critical finding if `alert_log` shows `>5` rows with `reason='auth_failed'` across any cron jobs within a rolling 1h window.
- Deduped per hour so it doesn't spam.
- This is the check that would have fired at ~02:00 UTC last night.

## Verification

- After (1): all four representative jobs return 200 within 5 min.
- After (2): next 21:30 UTC `secrets-health-check` run produces an `ok` row even with operator-token churn.
- After (3): manually clearing recent `ok` rows in a sandbox query reproduces the critical finding.
- After (4): inject 6 synthetic `auth_failed` rows into `alert_log` → sentinel-tick produces one critical finding, second tick within the hour does not duplicate.

## Deferred to next change

- (2 from prior msg) `rotate-awip-token` one-shot edge fn that writes DB + edge env + vault atomically and self-verifies via `secrets-health-check`.
- (5 from prior msg) Kill the vault read in `scheduled-lessons-daily` so there is one source of truth.
- Telegram webhook re-registration.
- `awip_reviews` / `heygen_videos` / `credit_entries` independent-loop diagnosis.

## Technical notes

- Migrations needed: none for (1); none for (2) beyond a cron edit via `supabase--insert` on `cron.job`; (3) and (4) are pure additions inside `sentinel-tick` plus two new rows in `sentinel_check_definitions` if that table is used, otherwise inline.
- `withLogger` wrap remains on all touched functions.
- No schema changes, no RLS changes.
