---
name: AWIP-as-MoE (ADR-0007)
description: Architectural stance — capability manifest = MoE router, tenant_node ancestry = hierarchical skim, per-capability verifiers = additive promotion gate. Intent only, no code; Part 2 (expert-feedback verifier) deliberately deferred.
type: design
---

ADR-0007 names the MoE pattern AWIP already has the substrate for. Three points:

1. **Router** lives in Control Plane or modules — never Core. Scores over existing `capabilities` manifest; no new table.
2. **Skim** sits downstream of Phase 5 resolver. Summarise per `tenant_node` ancestry level; drill down on low confidence band only.
3. **Verifiers** are additive to existing `capability_promotion` gates, never replacements. Per-capability deterministic check; declaration contract deferred to future ADR.

Build trigger for any of the three: ≥1 module producing real capability traffic. Until then, ADR is vocabulary only.

Part 2 (expert-feedback loop as verifier signal) is a standalone follow-up ADR held back until traffic exists.

See `docs/adr/0007-awip-as-moe.md`.
