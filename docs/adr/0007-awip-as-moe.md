# ADR-0007: AWIP-as-MoE — capability router, hierarchical skim, per-capability verifiers

- **Status:** proposed
- **Date:** 2026-05-24

## Context

FM domains are too broad for one monolithic model to answer well (`docs/why-awip.md`). DeepSeek V4 Pro's architecture — sparse expert activation, selective context skimming, per-specialist deterministic verifiers — is a useful analogy for how AWIP should *route, read, and reward* domain work. The vocabulary is missing today: the substrate (capability manifest, tenant_node ancestry, capability_promotion gates) is already in place, but nobody has named the pattern that ties them together, so module authors invent their own.

This ADR names the pattern. It does **not** introduce code. ADR-0001 (capability registry contract) and ADR-0003 (tenant-node ancestry storage) remain the operative contracts; this ADR sits on top of them as architectural intent.

## Decision

AWIP treats its domain specialists as a Mixture-of-Experts system over three existing substrates:

**1. Capability manifest is the MoE router.** The existing `capabilities` table (specialists), `okr_nodes` (symptoms), and Control Plane routing are the substrate. A future `capability_router` scoring function — cheap, deterministic, operating only over `capabilities.id` + `inputs_required` + `outputs_provided` + KR keywords — activates top-k specialists per request. The router lives in Control Plane or modules. **Never in Core.** No parallel manifest, no new substrate table.

**2. Tenant_node ancestry is the hierarchical skim substrate.** FM context is enormous (portfolio → site → floor → asset → work-order → lease → compliance). The skim move: summarise at each ancestry level, retrieve the summary first, drill down only when the confidence band from `resolve_truth` / `resolve_entity` demands it. Resolver picks the *node*; the skimmer picks *how deep to read*. Skim lives downstream of Phase 5 resolver, not inside it.

**3. Per-capability deterministic verifiers are the promotion gate.** `capability_promotion` today applies generic checks. This ADR establishes the principle that each capability *may* declare a domain-specific verifier (test pass-rate, schema conformance, rule-engine check) as an *additive* gate. Existing generic gates are not weakened. Verifier wiring is deferred to a future ADR.

## Consequences

**Easier.**
- Module authors have a named pattern to point at; no more bespoke routing inventions.
- Phase 5/6 retrieval work has a vocabulary for "summary-first, drill-on-demand".
- The promotion-gate roadmap has a documented end-state (per-capability verifiers) without committing build effort.

**Harder.**
- Three concepts (router, skim, verifier) now have a public name. Future contributors will expect them to exist; ADR must be linked from `docs/master-plan.md` so the deferred status is visible.
- Discipline required: this ADR is intent, not a build ticket. The Core rule ("substrate, not a brain — no who-acts-when logic") still forbids implementing the router in `awip-core`.

**Explicitly deferred.**
- `capability_router` scoring function, table, or edge-fn. Build only when ≥1 module produces real capability traffic to tune against.
- Skim summarisation pipeline. Build after Phase 5 resolver lands real confidence bands.
- Per-capability verifier harness. Future ADR-0008+ to specify the declaration contract.
- **Part 2 — expert-feedback as verifier signal.** Standalone follow-up ADR, deliberately held back until real capability traffic exists to ground thresholds.

**Explicitly out of scope.**
- Any change to `capability_promotion` gates today.
- Any change to ADR-0001 / ADR-0003 contracts.
- Any new RLS, event stream, cron, or edge function.
