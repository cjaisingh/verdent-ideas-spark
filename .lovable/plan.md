
# Fix the stale AWIP_SERVICE_TOKEN outage end-to-end

## Goal
Restore authentication for the 31 cron jobs that have been 401-ing for ~4 days, and close the structural gap that let `sentinel-watchdog` stay silent throughout.

## Non-goals
- Not rewriting the secrets-at-rest model (ADR-0009 stands).
- Not migrating cron jobs off `AWIP_SERVICE_TOKEN` onto per-job tokens (that's a separate W6 follow-up).
- Not touching the Vault MEK or any Supabase-managed key.

## Blast radius & Core rule / ADR / FM-AI cited
- **Tables / state:** `app_secrets` (AWIP_SERVICE_TOKEN row), `vault.secrets` (AWIP_SERVICE_TOKEN entry), `automation_runs`, `sentinel_findings`, `gh_actions_runs`.
- **Edge fns:** `secrets-health-check` (new UI wiring), `sentinel-tick` (watchdog path), every cron-fronted fn listed in `mem://features/secret-rotation-safety`.
- **Surfaces:** `/admin/secrets-health`, `/admin/edge-health`.
- **Core rule cited:** "Auth: operator JWT or `x-awip-service-token`; cron auth must be observable." (CONTEXT.md §Auth + `mem://features/secret-rotation-safety`).
- **ADR cited:** ADR-0009 secrets-at-rest — env is source of truth, `app_secrets` + `vault.secrets` are mirrors.
- **FM-AI failure mode defused:** "Silent dependency on a single shared credential with no out-of-band liveness probe" — same class as the FM-AI hidden-coupling failure documented in `docs/why-awip.md`.

## Alternatives considered
1. **Rotate the token to a new value now.** Rejected — there's no evidence the current value leaked; the failure is divergence between env/db/vault, not compromise. Rotating adds a re-issue step to every consumer without buying security.
2. **Re-register the 31 cron `cron.schedule(...)` bodies to read from a new shared source.** Rejected — schedules already resolve at runtime; the bug is the stores, not the schedules. Touching 31 schedules is unnecessary churn.
3. **Chosen: align edge env → `app_secrets` → `vault.secrets` via the new `?sync=env-to-all` mode, then add an out-of-band watchdog ping that cannot be 401'd by the same token.** Smallest blast radius; uses the code we already shipped this turn; addresses both the immediate outage and the structural blindness.

## Contract (cron/edge-fn touched)
- `secrets-health-check` already has a typed surface (mode = `check | env-to-db | env-to-vault | env-to-all`). New work only adds a UI caller — no new contract.
- New `sentinel-watchdog-ping` cron (step 4) needs a contract in `supabase/functions/_shared/contracts/sentinel-watchdog-ping.ts`:
  ```ts
  export type SentinelWatchdogPingInput = { source: "cron"; expected_max_age_minutes: number };
  export type SentinelWatchdogPingOutput = { ok: boolean; last_tick_age_minutes: number | null; escalated: boolean };
  ```
  Authenticates with `SUPABASE_SERVICE_ROLE_KEY` (NOT `AWIP_SERVICE_TOKEN`) so it survives exactly this failure mode.

## Persona sign-off
- **sentinel** — objects to "the only watchdog uses the credential it's watching"; answered by adding `sentinel-watchdog-ping` on a service-role-key path.
- **compliance-auditor** — wants the rotation procedure documented before next quarterly review; answered by the runbook in step 5.
- **event-engineer** — wants the sync action emitted as an event row; answered by the existing `automation_runs` insert in `secrets-health-check` (no new event type needed).
- **control-plane-operator** — wants no new routing logic in Core; the ping cron is a pure liveness probe, not a dispatcher. Satisfied.
- **product-historian** — wants `mem://features/secret-rotation-safety` updated with the env-to-all mode + ping; covered in step 6.

## Gap checklist
- [x] Idempotency — `set_awip_service_token` RPC is atomic across both stores; safe to re-run.
- [x] `*_events` emission — `automation_runs` already records every sync call with `detail.vault_sync`.
- [x] RLS + `has_role` — `secrets-health-check` is operator-JWT gated; ping cron uses service-role auth, no RLS surface.
- [n/a] Realtime publication — no new tables.
- [x] `observability_registry` — add row for `sentinel-watchdog-ping` (15-min cadence).
- [x] `withLogger` — wrap `sentinel-watchdog-ping`.
- [x] No new `any`.
- [x] mem rule — update `mem://features/secret-rotation-safety` + `mem://features/sentinel-watchdog`.
- [x] CHANGELOG — entry under Unreleased.
- [x] Docs — new `docs/runbooks/awip-service-token-rotation.md`; cross-link from `docs/runbooks/secrets-mek-rotation.md` and `mem://features/secrets-at-rest`.

## Test plan
1. **Vitest** — extend `secrets-health-check` tests with a case asserting `?sync=env-to-all` returns both `resynced_env_to_db` and `resynced_env_to_vault` populated when both stores diverge.
2. **curl_edge_functions** — after step 2 below, POST `?sync=env-to-all` with operator JWT and assert HTTP 200 + `ok=true` + `resynced_env_to_vault` includes `AWIP_SERVICE_TOKEN`.
3. **DB assertion** — `select count(*) from gh_actions_runs where created_at > now() - interval '30 min'` returns ≥1 within 15 min of the sync.
4. **DB assertion** — `select status, count(*) from automation_runs where job='sentinel-tick' and created_at > now() - interval '30 min' group by 1` shows `ok` rows.
5. **e2e** — new `e2e/sentinel-watchdog-ping.test.ts`: invoke ping with service-role key, assert `escalated=false` when `sentinel-tick` is fresh, `escalated=true` when stale (mock).

## Validation gates
Run after build, in order. Stop and fix on first failure:
1. `bun run lint:ratchet` — must pass.
2. `bun run test -- secrets-health-check` — must pass.
3. `bunx vitest run e2e/sentinel-watchdog-ping.test.ts` — must pass.
4. Operator fires `POST /secrets-health-check?sync=env-to-all` — response `ok=true`.
5. 15 min later: `gh_actions_runs` fresh row exists AND `automation_runs` for `sentinel-tick` is `ok`.
6. `sentinel_findings` does NOT contain new `secrets_health_stale` or `cron_auth_failures_burst` rows in the next 1 h window.

If any gate fails, diagnose via `supabase--edge_function_logs` on the failing function, fix, re-run from gate 1.

## Build steps (in execution order)
1. **Add `Sync env → all` button** to `src/pages/AdminSecretsHealth.tsx`. Two-step confirm, same pattern as existing sync button. Shows `resynced_env_to_vault` in the result panel.
2. **Operator fires sync** from the new button (this is the actual outage fix — code from prior turn + this button is all that's required to unblock the 31 crons).
3. **Create `sentinel-watchdog-ping` edge fn + cron** at 15-min cadence, auth via `SUPABASE_SERVICE_ROLE_KEY`. Checks `automation_runs` for `sentinel-tick` freshness; if older than 30 min, fires `sentinel_watchdog_silent` finding (critical) + Telegram via `telegram-send`.
4. **Add observability_registry row** for `sentinel-watchdog-ping`.
5. **Write `docs/runbooks/awip-service-token-rotation.md`** — 5-step procedure ending at the `?sync=env-to-all` button.
6. **Update memory** — `mem://features/secret-rotation-safety` (add env-to-all + ping), `mem://features/sentinel-watchdog` (add out-of-band path), `mem://index.md` (one-liner refresh).
7. **CHANGELOG entry** under Unreleased.

## Out of scope
- Per-cron token isolation (each cron gets its own narrowly-scoped token) — separate W6 ticket.
- Rotating to a fresh `AWIP_SERVICE_TOKEN` value — no compromise evidence, skip.
- Moving `vault.decrypted_secrets`-backed crons onto `app_secrets` for uniformity — tracked, not done here.
- Replacing `secrets-health-check`'s operator-JWT gating with a stricter role check — `has_role('admin')` upgrade is a separate hardening pass.
