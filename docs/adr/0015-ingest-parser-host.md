# ADR-0015: Ingest parser host (markitdown)

- **Status:** proposed
- **Date:** 2026-07-17
- **Deciders:** (operator sign-off required before acceptance)
- **Tracks:** issue #34
- **Scope note:** This ADR covers the **W9 markitdown parser** only. The CAD/IFC
  extraction sidecar and its isolation/hosting (W10-S5) are a separate decision —
  ADR-0011.

## Context

Client files must be converted to markdown before they can be chunked, embedded,
and retrieved. That conversion runs **markitdown**, a CPython library with heavy
optional dependencies (pandoc, libreoffice, tesseract, ffmpeg). Deno edge
functions cannot run it, so the parse must happen in a Python process outside
Core, which then posts chunks back to the `ingest-callback` edge function
(HMAC-signed, fixed chunk contract).

Two mechanisms exist for that Python process:

- **GHA worker (built, working).** `scripts/ingest-bulk-worker.py` +
  `.github/workflows/ingest-bulk.yml` — runs nightly (02:30 UTC) and on manual
  dispatch, claims `pending`/`failed` `gha-bulk` files, downloads via signed URL,
  runs markitdown, HMAC-signs, and POSTs to `ingest-callback`. Claim is
  select-then-patch relying on concurrency-1 (acknowledged in-code).
- **Hosted sidecar (specced, not built).** `docs/runbooks/ingest-sidecar.md`
  fully specifies a long-running container (same callback contract), but its
  deploy target is explicitly deferred and **no container exists in the repo**.

The forces: a hosted sidecar gives near-real-time parsing and keeps heavy deps
hot, but adds an always-on service — a host, secrets, a deploy pipeline,
monitoring, and cost. The GHA worker needs none of that and already works, at
the price of batch (not interactive) latency and GHA-runner throughput limits.

## Decision

**Bless the GHA worker as the sole v1 ingest parser. Do not stand up a hosted
markitdown sidecar until near-real-time parse latency is a stated user
requirement.** Keep the `ingest-callback` contract (HMAC auth + chunk shape)
stable so a sidecar can be added later as an additional producer without any
change to Core. Remove the "deploy target deferred" ambiguity from the sidecar
runbook by marking the hosted sidecar "not in v1".

## Consequences

**Easier.** Zero new infrastructure, cost, secrets, or monitoring surface; the
path already works end-to-end; markitdown's heavy dependencies are installed per
run by the workflow rather than maintained on a live host; one fewer always-on
service to secure and patch.

**Harder.** Parse latency is **batch**, not real-time — a file uploaded at 10:00
is not parsed until the next scheduled run unless an operator triggers a manual
dispatch. Throughput is bounded by the workflow's concurrency-1 claim and GHA
runner limits, and large backfills consume GHA minutes.

**Explicitly accepted.** Batch latency in v1. If operators need faster
turnaround before the sidecar exists, the interim levers are increasing the
workflow cadence, raising concurrency (with a safe claim), or manual dispatch.

**Not doing.** No hosted markitdown container in v1. This decision does **not**
cover the CAD/IFC sidecar (ADR-0011), which has its own isolation and hosting
requirements.

## Options considered

1. **GHA worker only (chosen).** No new infra; batch latency; already working.
2. **Hosted markitdown sidecar** (Cloud Run / Fly / Render). Near-real-time and
   deps stay hot, but new infra + cost + ops + secrets — premature without a
   latency requirement, and it would sit idle most of the day.
3. **Both** — GHA for bulk backfill, sidecar for interactive uploads. Most
   flexible, most operational surface. Defer until demand justifies it.

## Rollout (triggers to revisit)

Re-open this decision when any of the following holds, and enter the sidecar's
estimated monthly cost into the credit ledger (per the W10 plan setup note)
before standing one up:

1. Operators report unacceptable parse latency for the real workload; **or**
2. Interactive upload UX requires sub-minute parsing; **or**
3. GHA-minutes cost for parsing exceeds the cost of a hosted container.
