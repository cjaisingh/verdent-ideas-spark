# ADR-0001: Capability registry contract

- **Status:** accepted
- **Date:** 2026-05-06

## Context

AWIP is a constellation of Lovable projects. Module projects (CDPs, agents, connectors) need a way to announce what they can do, and Core needs to surface what's demanded but not yet built. Without a contract, every module integration is bespoke and "what's missing?" requires reading code across repos.

## Decision

Capabilities are content-addressed by a stable string `id` (e.g. `desk_utilisation_measurement`). Module projects self-register with `POST /capabilities/register`, which upserts into `capabilities` and emits a `capability_events.registered` row. Operators query the manifest via `GET /capabilities`. The demand aggregate at `GET /capabilities/demand` ranks both **registered** capabilities and **unknown** capabilities — capability ids referenced by KRs but never registered. Unknown capabilities are first-class signals, not validation errors: ingest accepts them with a warning.

## Consequences

- Discovery AI can author OKRs that reference capabilities the platform doesn't yet have, and the demand aggregate tells operators what to build next.
- Capability `id` is now a permanent public identifier — renaming requires a deprecation cycle.
- Modules can ship independently of Core: they self-register on boot.
- We accept that a typo in a capability id will silently produce an "unknown" demand row rather than failing loudly. The `resolution_warning` event (ADR-derived, see future ADR) makes that visible.
