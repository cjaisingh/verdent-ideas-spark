---
name: fm1-stakeholder-intelligence
description: First registered FM module — Stakeholder Intelligence; reference example for FM2–FM12.
type: feature
---

FM1 is the first real module entry in `public.capabilities` (owning_module='fm1'). It is the **reference scaffold** future FMs copy from. The 3 seeded capabilities are:

- `fm1_stakeholder_profile` — canonical stakeholder records (entity output).
- `fm1_stakeholder_engagement_signal` — engagement intensity (time-series input → metric).
- `fm1_stakeholder_sentiment_pulse` — sentiment indicator (prose input → metric).

All `status='planned'`, `version='0.1.0'`. **Manifest entry only — no running service yet.** The FM1 project will ship as a separate Lovable project; on first deploy it should re-register through `POST /capabilities/register` to exercise the live contract (Idempotency-Key + service token + `capability_events` emission). The sandbox seed went via direct insert because the curl tool couldn't reach the service-token auth path; either path produces equivalent rows.

**Naming:** capability ids use `fm{N}_<surface>_<capability>` (underscores only — the `validateRegisterInput` regex `[a-z][a-z0-9_]{2,79}` forbids dots).

**Why:** AWIP's constellation diagram shows 12 FMs around Core. Without at least one registered module, Core is talking to itself (FM-AI failure mode #1). FM1 makes the loop real. The `demand-analyst` persona accepts demand=0 at seed time; will flag if no KR cites these capabilities within 60d.

**Out of scope (deferred):** FM2–FM12 registration (one module at a time, demand-driven), the actual FM1 service implementation, KRs targeting FM1 capabilities, UI grouping by `owning_module` on `/capabilities`.

**Related:** ADR-0001 (capability registry contract), `docs/module-scaffold/`, `mem://features/module-contracts`.
