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

## Promotion criteria

This ADR moves from `proposed` → `accepted` (and a follow-up ADR is opened to specify the verifier contract) only when **all** of the following are true:

1. **Capability traffic exists.** At least one registered module is writing to `capability_events` continuously for ≥30 days (verified via `select count(*) from capability_events where created_at > now() - interval '30 days' group by capability_id having count(*) > 0` returning ≥1 row).
2. **At least one expert-feedback source is wired.** One of: operator up/down-vote UI on a capability surface, an AWIP Review finding tagged `capability_*`, a sentinel kind with prefix `capability_`, or a post-hoc audit row referencing a capability id.
3. **A test fixture exists.** A vitest or Deno fixture under `e2e/` or `supabase/functions/_shared/contracts/` that seeds ≥1 positive and ≥1 negative expert-feedback signal and asserts the deterministic gate's behaviour is unchanged in their absence.
4. **No deterministic gate is bypassed.** The follow-up ADR must show the verifier score as an **additive** filter applied *after* every deterministic gate has passed — never as a substitute.

Until **all four** are demonstrable, this ADR remains `proposed` and the vocabulary stays load-bearing only.

A `proposed` ADR with no eligible traffic for ≥180 days from acceptance of ADR-0007 should be reviewed for `superseded` or `withdrawn` status rather than left dangling.
