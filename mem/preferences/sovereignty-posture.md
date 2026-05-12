---
name: Sovereignty posture
description: Current sovereignty tier (Tier 1 — Posture), what's claimed, what's intentionally not claimed, and where the backlog lives
type: preference
---

**Current tier: Tier 1 — Posture.** Architecture supports a sovereignty story; we make no contractual or marketed claim.

**Region:** `eu-west-1` (AWS Ireland) via Lovable Cloud. Single region, no cross-region replicas. No per-tenant region today.

**Egress, intentionally accepted at Tier 1:** Gemini, OpenAI, GitHub mirror, Telegram, Deepgram. Listed honestly in `docs/sovereignty.md` §4. AI egress is the biggest leak and is its own deferred workstream — do **not** propose constraining it under the sovereignty label without raising that workstream first.

**Not claimed today (do not market):** in-region AI, CMK/BYOK, per-tenant region, export/delete endpoints, signed audit exports, sub-processor opt-in, ISO 27001 evidence pack, executed DPA. (`/trust` page exists at Tier 1 — region + egress + sub-processors + "what we don't claim"; per-tenant region attestation, last audit date, sub-processor change-log are still Tier 2 backlog.)

**Source of truth:** `docs/sovereignty.md`. Any new external service must update §5 sub-processor table in the same change, then run `bun run subprocessors:generate` to refresh `docs/legal/sub-processor-list.md` (CI `doc-drift` blocks PR if stale). Any tier escalation must update both the doc's "Current tier" line and this memory.

**Why:** lets us answer "is data sovereign?" honestly without committing to engineering work nobody has paid for yet.

**How to apply:** when asked about sovereignty, link `docs/sovereignty.md` or send buyers to the in-app FAQ at `/sovereignty` (Tier 1/2/3 tagged Q&As, hand-curated, must stay consistent with the source doc). When asked to *make* it a USP, point at the three positioning options + tier requirements rather than just agreeing.
