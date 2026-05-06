
# Adopt three small Ruflo-inspired patterns

Three additions, each independently revertable. We commit to a periodic review (noted in `docs/adr/README.md`) of whether to take more from Ruflo — the default answer stays "no" unless a concrete AWIP pain matches a Ruflo pattern.

## 1. `docs/adr/` with template + two seed ADRs

Create:

- **`docs/adr/README.md`** — explains the ADR convention, numbering, status lifecycle (`proposed` → `accepted` → `superseded`), and a standing "Ruflo review" note: every time we consider adopting a Ruflo pattern, log it as an ADR (accepted or rejected with reason) so we don't churn on the same questions.
- **`docs/adr/_template.md`** — 1-page template: Context / Decision / Consequences / Status / Date.
- **`docs/adr/0001-capability-registry-contract.md`** — codifies the existing contract: capabilities are content-addressed by `id`, registered via `POST /capabilities/register`, surfaced via `/capabilities` and `/capabilities/demand`. Unknown capabilities referenced by KRs are first-class signals, not errors.
- **`docs/adr/0002-service-token-and-idempotency.md`** — codifies: service-token auth path for cross-project calls, `Idempotency-Key` required on writes, body-hash conflict → 409, replay → cached response with `idempotent_replay=true` in logs.

No code changes, just docs.

## 2. Redaction helper in `awip-api`

Add a `redact(value)` function in `supabase/functions/awip-api/index.ts` that walks any JSON value and replaces matches with `"[REDACTED]"`:

- `sk-[A-Za-z0-9_\-]{16,}` (OpenAI / Anthropic-style keys)
- `Bearer\s+[A-Za-z0-9._\-]+` (auth headers leaked into bodies)
- JWT shape: `eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+`
- `x-awip-service-token` value if it appears anywhere in a string

Apply it inside `logApiCall` to `request_summary`, `response_summary`, and `error` **before** insert, and inside the event-insert helpers (`okr_node_events.payload`, `capability_events.payload`) before insert. Keep redaction defensive: scan strings recursively, leave non-string leaves alone, cap recursion depth at 8 to avoid pathological payloads.

Add `e2e/redaction.test.ts`:
- Send `/okr/ingest` with a fake `sk-…` string buried in a `data_sources[].notes` field; assert it does not appear in `api_call_logs.request_summary` or in any `okr_node_events.payload` row.
- Same for a `Bearer …` and a JWT-shaped string.

## 3. `capability_resolution_warnings` event type

Inside the `/capabilities/demand` handler in `awip-api`, after computing the demand aggregate, for each entry where `status === "unknown"` **or** (`status !== "unknown"` and `owning_module` is null and `active_kr_count > 0`), emit one row to `capability_events`:

- `capability_id` = the demanded id
- `event_type` = `"resolution_warning"`
- `actor` = the calling actor
- `payload` = `{ reason: "unowned" | "unknown", tenant_count, active_kr_count, tenant_ids }`

To avoid a flood (the demand endpoint may be polled), de-dupe: only emit if no `resolution_warning` row exists for that `capability_id` in the last 10 minutes. Implement the de-dupe with a single `select … where event_type='resolution_warning' and capability_id in (...) and created_at > now()-interval '10 minutes'` and skip ids present in the result.

Surface these in the existing `/events/recent` stream automatically (it already merges `capability_events`). No new endpoint.

Add to `e2e/coverage.test.ts` (or new `e2e/resolution-warnings.test.ts`):
- Ingest a tenant with a KR referencing an unknown capability, call `/capabilities/demand`, assert a `capability_events` row with `event_type='resolution_warning'`, `payload.reason='unknown'` exists.
- Call `/capabilities/demand` again immediately, assert no duplicate row was added (de-dupe works).

## Out of scope (revisit at next ADR review)

- Ruflo's hooks framework, swarm runtime, plugin marketplace, signed witness manifests, tiered embedding fallback. Logged as "considered, deferred" in `docs/adr/README.md` so future Lovables don't re-propose them.

## Files

- create: `docs/adr/README.md`, `docs/adr/_template.md`, `docs/adr/0001-capability-registry-contract.md`, `docs/adr/0002-service-token-and-idempotency.md`, `e2e/redaction.test.ts`, `e2e/resolution-warnings.test.ts`
- edit: `supabase/functions/awip-api/index.ts` (redaction helper + apply it in `logApiCall` and event inserts; emit `resolution_warning` from `/capabilities/demand` with 10-min dedupe)
- redeploy: `awip-api`
