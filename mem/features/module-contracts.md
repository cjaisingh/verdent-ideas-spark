---
name: Module contract hardening
description: Per-module hashed service tokens + heartbeats + granular capability_events; required before any second Lovable project writes to Core
type: feature
---

`module_service_tokens` (sha256, per-`owning_module` scope) and `module_heartbeats` make Core safe for a second Lovable project. `awip-api.authorize()` resolves per-module tokens via `resolve_module_token()` and returns `owning_module`; writes enforce `token_scope === payload.owning_module` (legacy global `AWIP_SERVICE_TOKEN` stays unscoped for Discovery AI + cron).

**`POST /capabilities/register`** is now idempotent (header `Idempotency-Key` or body field; 409 on body-hash mismatch) and emits granular events on diff: `status_changed`, `version_bumped`, `owning_module_changed`, `deprecated` — plus `registered` on first sight.

**`POST /modules/heartbeat`** writes to `module_heartbeats` (high-volume, separate from `capability_events`). Sentinel `module_silent_24h` (medium) fires when any module with ≥1 registered capability is silent >24h.

Typed contracts live in `supabase/functions/_shared/contracts/module-{register,heartbeat,promote}.ts` per `mem://preferences/contract-first`.
