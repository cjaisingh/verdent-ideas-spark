## Cleanup backlog — verified

Deep-dive findings. The sentinel inbox lied to me on the first pass; here's what's actually happening.

### 1. Sentinel findings — most are false / stale

| Finding | Real status | Root cause |
|---|---|---|
| `sentinel-tick: 48 errors in 24h (48%)` | **Stale**. Tick has been green since 16:47 UTC yesterday. | `AWIP_SERVICE_TOKEN` rotated at ~15:30 yesterday; every cron job using it failed for ~90 min until `secrets-health-check` realigned. The 24h rolling rate is decaying. |
| `Cron lessons-synthesize has not run in ever (10080m)` | **False positive.** Last ran Sun 2026-05-17 05:00 UTC. Weekly schedule `0 5 * * 0`. | Sentinel `cron_silence` check ignores cadence; treats any gap > threshold as silent without checking schedule expression. |
| `Cron deep-audit has not run in ever (10080m)` | **False positive.** Same: last ran 2026-05-17, weekly. | Same bug. |
| `Cron app-walkthrough has not run in ever (1440m)` | **Likely real.** No row in `automation_runs` ever. Cron is registered (`scheduled-app-walkthrough 15 2 * * *`) and active. | Either the function isn't writing to `automation_runs`, or it boots-then-shuts-down silently (logs show only Boot/Shutdown). Needs a trace. |
| `Cron ci-status-sync-30m has not run in ever (30m)` | **Real.** Job is active in `cron.job`, but no `automation_runs` rows and edge function logs show only Boot/Shutdown. | Function likely returning 200 without recording — same pattern as app-walkthrough. |
| `Telegram webhook silent for 10h` | **Real.** `telegram-webhook-reregister` is failing today with `getWebhookInfo failed` (3 errors since 22:15 yesterday). | Auto-recovery itself is broken — needs the actual HTTP response body to diagnose. |
| `No new approvals in 323h` | **Real, but probably noise.** 13 days without an approval. | Either bump threshold or mute — there's no operational signal here. |
| `What's New: 445 unreviewed drafts` | **Real backlog.** | Add a retention/auto-archive sweep, or bulk-review. |

**One real bug worth fixing:** the `cron_silence` check should parse the cron expression and only fire when `now() - last_run > expected_interval × N`. Right now it just looks at `last_seen` vs a fixed minutes window per `cadence_minutes` config — but weekly jobs with cadence 10080 still fire on a 1d-stale check because the message text is "has not run in ever" (suggests the check uses `coalesce(max(created_at), -infinity)` and the threshold comparison is wrong for weekly).

### 2. Token rotation aftershock

The 24h error spike across `sentinel-tick`, `tomorrow-plan-refresh`, `overnight-phase-runner-15m`, `telegram-webhook-reregister` all share one cause: `AWIP_SERVICE_TOKEN` got out of sync between env and DB, `secrets-health-check` healed it. Worth:
- Confirming `secrets-health-check` ran `?sync=env-to-db` (per `mem://features/secret-rotation-safety`).
- Adding a `secret_sync_event` row so the rotation is explicit, not implicit-via-error-burst.

### 3. Lint debt (real, growing)

Baseline grew from 302 → **517 occurrences across 106 files**. `discussion_action #20` is `in_progress` with no recent movement. Two parallel tracks now that the ratchet config supports multiple rules:

- **Shrink existing `no-explicit-any`** — top-10 files only, replace with `unknown` + narrow casts.
- **Add `prefer-const` to ratchet config** — cheapest mechanical win, currently `warn`. Same for `no-empty`.

### 4. Edge-function audit follow-ups (still open from 2026-05-10)

Three functions flagged "needs operator decision" — `automation-auth-monitor`, `copilot-voice`, `roadmap-phase-signoff`. `automation-auth-monitor` is actively running (151 ok runs in 24h) so keep that one; the other two still unverified.

### 5. CodeQL operator action

`discussion_action ff5743f8…` — disable default setup + dismiss 28 alerts on GitHub. Pure operator click, no code.

### 6. Quick wins

- **`whats-new` 445 drafts** — auto-archive drafts > 30 days old with no reviewer.
- **Short-link GC** — `short_links` has `last_used_at` but no sweep. Add to `retention-sweep`.
- **Doc consolidation** — `docs/edge-function-audit.md` and `docs/edge-function-sweep-2026-05-10.md` overlap; collapse into one canonical doc.

## Suggested order

1. **Fix sentinel `cron_silence` to respect cron expression** — kills 3 false-positive findings in one shot and prevents the next operator from chasing ghosts. ~30 min.
2. **Diagnose `app-walkthrough` + `ci-status-sync-30m` silence** — boot-then-shutdown logs suggest they return 200 without doing work. Read the function bodies, confirm whether `automation_runs` insert is in the happy path.
3. **Fix `telegram-webhook-reregister` getWebhookInfo failure** — pull response body, likely a stale `TELEGRAM_BOT_TOKEN`.
4. **Mute or bump `approvals_stale` + bulk-archive `whats_new` drafts** — kills the last two medium findings.
5. **Then choose:** lint shrink, CodeQL operator action, or audit follow-up.

## Question

Want me to start with **(1) the `cron_silence` cadence bug** — that's the highest-leverage fix because every other finding is easier to read once the false positives are gone. Or jump straight to **(3) Telegram** if operator messaging matters more right now?
