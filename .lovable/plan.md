## Goal
Stop "sentinel is the only thing watching sentinel" by adding an out-of-band watchdog that pages Telegram directly when `sentinel-tick` itself goes silent, and codify a standing rule that every new chat session glances at last-24h cron auth failures before answering.

## Non-goals
- Not redesigning `sentinel-tick` itself or its 22 existing checks.
- Not fixing the live `AWIP_SERVICE_TOKEN` rotation (that's the ops step you'll run separately).
- Not adding a third monitoring layer — one out-of-band watchdog is enough.

## Blast radius & rule cited
- New edge fn: `sentinel-watchdog` (single-purpose, no shared auth with sentinel-tick).
- New pg_cron: `scheduled-sentinel-watchdog` every 15 min.
- New table: `sentinel_watchdog_runs` (heartbeat + last-alert dedupe).
- New mem rule under Core.
- Edits: `mem/index.md`, `docs/sentinel.md`, `CHANGELOG.md`.
- **Core rule defused**: silence detectors need their own silence detector (already in `mem://features/sentinel-monitoring-coverage`, never operationalised for sentinel-tick itself).
- **FM-AI failure mode**: "monitor of monitors collapses to a single point" — exactly what bit us today.

## Alternatives considered
1. **External uptime ping (UptimeRobot/Healthchecks.io)** — most robust (truly off-platform) but adds a vendor + secret + signup. Rejected: out of proportion for one watchdog; revisit if this fails too.
2. **Second pg_cron job with inline `net.http_post` to Telegram, no edge fn** — simplest, but puts the bot token and message templating into a SQL string and bypasses `withLogger`. Rejected: violates Core rule (every edge fn wrapped) and makes the token rotation story worse.
3. **Chosen: dedicated `sentinel-watchdog` edge fn + its own cron, auth via anon JWT only** — no dependency on `AWIP_SERVICE_TOKEN` (the exact thing that broke), uses existing `telegram-send` path, fits the existing `withLogger`/contracts pattern.

## Contract
`supabase/functions/_shared/contracts/sentinel-watchdog.ts`:
```ts
export type SentinelWatchdogInput = { trigger: "cron" | "manual" };
export type SentinelWatchdogOutput = {
  ok: true;
  sentinel_last_run_at: string | null;
  minutes_silent: number | null;
  alerted: boolean;
  reason: "healthy" | "stale" | "never_ran" | "deduped";
};
```
Watchdog rules:
- Query `max(created_at)` from `automation_runs where job='scheduled-sentinel-tick' and status='ok'`.
- If `minutes_silent > 30` OR no row in 24h → fire Telegram via `telegram-send` with title `🚨 Sentinel silent` and body listing the gap + top 5 failing crons from the same query.
- Dedupe: don't re-alert within 6h for the same `dedupe_key = sentinel-silent::<YYYY-MM-DD-HH>` (stored in `sentinel_watchdog_runs.last_alert_key`).
- Auth: `verify_jwt = false`, gated by `x-awip-watchdog-token` (NEW secret — deliberately separate from `AWIP_SERVICE_TOKEN`).
- Wrapped in `withLogger`.

## Persona sign-off
- **sentinel**: "What's the dedupe?" → hour-bucket, 6h cooldown, auto-resolves implicitly when next healthy run logs.
- **event-engineer**: "Does it emit?" → writes `sentinel_watchdog_runs` row every tick (heartbeat) + on alert. No `*_events` row needed — it's not a domain mutation.
- **control-plane-operator**: "No routing in Core?" → fine, it's pure observability, no action dispatch.
- **compliance-auditor**: "Token sprawl?" → one new secret, justified by the exact failure mode it defuses; documented in `mem://features/secret-rotation-safety`.

## Gap checklist
- [x] Idempotency: dedupe via hour-bucket key.
- [x] RLS: `sentinel_watchdog_runs` operator-only SELECT, service_role full.
- [x] Realtime: not needed (low cardinality, polled by /admin/edge-health).
- [x] `observability_registry`: add row for `sentinel-watchdog` so the registry itself flags if IT goes silent (yes, turtles all the way down — but bounded at 2).
- [x] `withLogger`: yes.
- [x] No new `any`.
- [x] Mem rule: add Core line "Every new session: glance at last-24h `automation_runs` 4xx/5xx before first substantive answer."
- [x] CHANGELOG + `docs/sentinel.md` updated.
- [ ] **Out of scope**: external uptime ping (option 1) — log via plan-footer-ingest.

## Test plan
- `supabase/functions/sentinel-watchdog/checks_test.ts` (Deno): unit cases for healthy / stale-30m / never-ran / deduped-within-6h.
- `supabase--test_edge_functions` against the new fn before deploy.
- Manual `supabase--curl_edge_functions` with `?trigger=manual` after deploy, asserting `alerted=true` while sentinel is still down (today's state — perfect smoke test).
- Add a row to `observability_registry` and re-run the existing `observability_missing_watcher` check to confirm it greens.

## Validation gates
After build, run in order — all must pass:
1. `bun run lint:ratchet` — no new any, no logger gaps.
2. `supabase--test_edge_functions` for `sentinel-watchdog` — all 4 cases green.
3. `supabase--deploy_edge_functions` `["sentinel-watchdog"]`.
4. `supabase--curl_edge_functions` `/sentinel-watchdog?trigger=manual` with the new watchdog token → expect `alerted=true`, Telegram arrives.
5. Confirm `sentinel_watchdog_runs` has the heartbeat row.
6. Confirm the cron registration via `supabase--read_query` on `cron.job`.

## Out of scope
- External uptime vendor (option 1) — revisit only if the watchdog itself fails.
- Auto-rotating `AWIP_SERVICE_TOKEN` on auth-burst — separate discussion, would belong in `secrets-health-check`.
- Backfilling missed alerts for today's gap — once sentinel is back, normal flow resumes.

## What I need from you
One decision before I build:
- **New secret name**: `AWIP_WATCHDOG_TOKEN` (deliberately separate from `AWIP_SERVICE_TOKEN` so a rotation of one never silences the other). OK to add via `add_secret` when you approve the plan?
