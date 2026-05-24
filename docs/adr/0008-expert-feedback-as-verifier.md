# ADR-0008: Expert feedback as a verifier signal

- **Status:** proposed
- **Date:** 2026-05-24

## Context

ADR-0007 named the MoE pattern AWIP's substrate supports and split it into three pieces (router / skim / verifier). Part 1 (router + skim + deterministic per-capability verifiers) is the substrate stance and was accepted. Part 2 — using **expert feedback** (operator votes, post-hoc audits, sentinel findings, AWIP Reviews) as an **additional verifier signal** that promotes or demotes capabilities — was deliberately deferred.

This ADR holds that vocabulary so future capability traffic can be reasoned about consistently. It does not change any code, schema, or event stream.

## Decision

When ≥1 module produces real capability traffic and at least one expert-feedback source (operator vote, AWIP Review finding, sentinel `capability_*` finding, post-hoc audit row) is wired into `capability_events`, propose a follow-up ADR that:

1. Defines the **per-capability verifier contract** — what signal kinds count, weights, decay window.
2. Adds an **additive** check in `capability_promotion` gates that reads aggregated verifier scores. Never *replaces* an existing deterministic gate.
3. Routes negative verifier signals (operator down-vote, repeated sentinel finding) into the same demotion path the deterministic gates already use.

Until that traffic exists, this ADR stays `proposed` and Part 2 is **vocabulary only** — no router, no scoring table, no scheduled job.

## Consequences

- Locks the term "expert-feedback verifier" so we don't reinvent it ad-hoc when the first signal lands.
- Cheap: zero code, zero migration, one file.
- Explicit non-decision: we are *not* committing to a scoring schema or weights — those belong in the follow-up ADR with real data to calibrate against.
- Cross-refs `docs/adr/0007-awip-as-moe.md` § Decision (point 3 = verifiers) and `mem://features/awip-as-moe`.
