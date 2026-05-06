# ADR-0002: Service token + idempotency for cross-project writes

- **Status:** accepted
- **Date:** 2026-05-06

## Context

Cross-project callers (Discovery AI, future modules) need to write to Core without an interactive operator session, and they need to be safe to retry. Network retries, agent re-runs, and CI replays must not duplicate OKRs or events.

## Decision

Two auth paths into `awip-api`:

1. **Operator JWT** — Supabase access token; user must hold the `operator` or `admin` role.
2. **Service token** — `x-awip-service-token` header matched against the `AWIP_SERVICE_TOKEN` Supabase secret. Authorized as `service:<project>`.

All write endpoints accept an `Idempotency-Key` header (1–200 printable ASCII, no whitespace; validated before auth). For supported writes (`/okr/ingest`, `/events/ingest`):

- First call: response is cached in `idempotency_keys` along with a SHA-256 of the request body.
- Replay with the same key + same body: returns the cached response, `api_call_logs.idempotent_replay = true`.
- Replay with the same key + a **different** body: `409 Conflict`. Callers must rotate the key.
- Malformed JSON: `400`, never `500`.

## Consequences

- Cross-project callers can retry freely without manual de-duplication.
- A stolen service token grants full write access to Core — rotation is a Supabase secret update plus a redeploy of all caller projects. Tracked via the `secrets` panel; not yet automated.
- Idempotency storage grows unbounded. Acceptable at v1 volume; revisit with a TTL policy when row count exceeds ~1M.
- The body-hash check means callers cannot "fix up" a request by changing the body and reusing the key — this is a feature, not a bug.
