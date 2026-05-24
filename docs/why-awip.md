# Why AWIP Exists

AWIP is built to prevent the four conditions that, in our experience, quietly kill Facilities Management (FM) AI projects. Every design decision in Core — the OKR tree, the capability manifest, the event streams, the demand board, the assistant layer — exists to defuse one of these failure modes before it takes root.

This document is the founding "why". If a proposed change to AWIP doesn't make at least one of these four conditions less likely, it probably doesn't belong in Core.

## The four killers

### 1. Nobody understands the problem

Most failed FM AI pilots start without a sharp answer to "what are we actually solving, for whom, and how will we know it worked?" Vague problem statements produce vague capabilities, which produce demos nobody uses.

**How AWIP defuses it.** The OKR tree and capability manifest make the problem explicit and machine-readable:

- Every objective and key result is a row in `okr_nodes`, with an owning tenant, a parent, and a measurable target.
- Every capability declares its inputs, outputs, owning module, and the KRs it serves.
- "What is this for?" is always answerable by walking the tree — not by re-reading a slide deck.

No vague pilots. If a capability can't point to a KR, it doesn't ship.

### 2. The conditions have changed

FM environments shift constantly: portfolios change, regulations change, contracts change, leadership changes. Pilots built against last quarter's reality silently become irrelevant, and nobody notices until the renewal conversation.

**How AWIP defuses it.** Every OKR mutation is recorded with full event history:

- Inserts, updates, supersessions, and spawns all emit `okr_node_events` rows (Core rule #1).
- Priorities can be **superseded**, not deleted — the trail survives.
- Downstream consumers (Control Plane, Discovery AI, Morning Review) read the event stream, so they always reflect the current reality, not a stale snapshot.

When the conditions change, the system changes with them — and the history of *why* it changed is preserved.

### 3. The cost outweighs the value

AI capabilities are easy to ship and hard to retire. Without explicit signal on which capabilities are actually used and which KRs drive them, dead weight accumulates until the unit economics collapse.

**How AWIP defuses it.** The demand board (`/control-plane`, backed by `GET /capabilities/demand`) surfaces:

- Which capabilities have active KRs pointing at them, ranked by `active_kr_count` and `tenant_count`.
- Which capabilities are referenced by KRs but have never been registered (`unknown` capabilities — demand without supply).
- Which capabilities exist but no KR points at them (supply without demand — candidates for deprecation).

Cost/value decisions become data-driven instead of political.

### 4. The team has lost belief

The slowest-moving killer, and the most fatal. Once the people who actually run the building stop believing the AI helps them, no amount of model improvement recovers the project.

**How AWIP defuses it.** AWIP is designed to feel like a smart colleague, not a form to fill in:

- The assistant layer (**Capica**) exists specifically to maintain engagement and belief — it remembers context, surfaces the right thing at the right time, and behaves like someone who has read the file before the meeting.
- The operator console treats the operator as the principal, not as a data-entry surface.
- Every interaction leaves a trail the operator can audit, so trust compounds rather than erodes.

If a feature would make AWIP feel more like paperwork and less like a colleague, it fails this test.

## Using this framing

- **For new contributors:** read this before the architecture docs. The "what" makes more sense once you know the "why".
- **For FM stakeholders:** this is the version to share. It's deliberately written without AWIP-internal jargon.
- **For agents working in Core:** when a request feels architecturally off, check it against the four killers. Does this change make one of them less likely, or more?

The full set of non-negotiable engineering rules lives in [`CONTEXT.md`](../CONTEXT.md). This doc is the layer above them: the reason those rules exist in the first place.

## How the substrate scales (ADR-0007)

The four killers stay defused only if the substrate stays cheap as capability count grows. [`ADR-0007 — AWIP as MoE`](./adr/0007-awip-as-moe.md) names the pattern we already have the substrate for: the capability manifest is the Mixture-of-Experts **router** (lives in Control Plane / modules — never Core), `tenant_node` ancestry is the hierarchical **skim**, and per-capability deterministic **verifiers** are additive to existing promotion gates. No new tables, no new event streams; it is vocabulary for what `capabilities`, `tenant_nodes`, and `capability_promotion` are already shaped to support. Build trigger: ≥1 module producing real capability traffic. Part 2 (expert-feedback as verifier signal) is held back as a standalone follow-up ADR until that traffic exists.
