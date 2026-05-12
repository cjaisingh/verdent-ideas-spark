# Plan: Scope a data-sovereignty story for AWIP Core

Goal: produce the artifacts and architectural changes that would let us *credibly* market sovereignty later, without committing to it as the USP today. AI egress is explicitly out of scope for this pass — we'll handle that as a separate workstream.

## Outcome

A new doc `docs/sovereignty.md` plus a tiered checklist in the master plan, so we can decide later whether to ship Tier 1, 2, or 3. Nothing is marketed externally until a tier is chosen.

## Three tiers (the decision surface)

```text
Tier 1 — POSTURE (what we already have, written down)
  Region statement, RLS posture, audit trail, sub-processor list.
  No code changes. ~0.5 sprint of docs.

Tier 2 — CONTRACTUAL (defensible claim)
  Per-tenant region field, export/delete API, DPA template,
  trust page, data-flow diagram, retention policy.
  ~1 sprint. No AI egress changes.

Tier 3 — SOVEREIGN-GRADE (sellable to regulated buyers)
  CMK/BYOK story, in-region AI mode, signed audit exports,
  per-tenant sub-processor opt-in, ISO 27001 evidence pack.
  Multi-sprint. Needs the AI egress workstream done first.
```

## Workstream A — Tier 1 (docs only, do now)

- New `docs/sovereignty.md` with five sections:
  1. **Where your data lives** — name the region (confirm from Lovable Cloud project info), state "single region, no replication".
  2. **Who can read it** — link to `docs/security.md` (RLS, operator-only, service-token model).
  3. **What we record** — link to `api_call_logs`, `*_events`, retention = forever (today).
  4. **What leaves the region** — honest list: AI gateway calls (Gemini/OpenAI), GitHub mirror, Telegram. Mark each as "egress" with purpose.
  5. **Sub-processors** — Lovable Cloud (Supabase), Google AI, OpenAI, GitHub, Telegram, Deepgram. Table with purpose + region + data class.
- Update `README.md` and `docs/master-plan.md` to link `sovereignty.md` under "Module map".
- Add `mem/preferences/sovereignty-posture.md` capturing the tier we're at and what's intentionally not claimed.

## Workstream B — Tier 2 scope (plan, don't build)

Document in `docs/sovereignty.md` as "Tier 2 backlog" with rough sizing:

- **Per-tenant region field** on `tenants` (`region text not null default '<current>'`) + a check that no cross-region writes happen. Today single-region, so it's a label; becomes meaningful when we add a second region.
- **Export endpoint** `/awip-api/tenants/:id/export` — returns a signed zip of all rows for that tenant across every table. Need a `tenant_export_jobs` table and an edge function.
- **Delete endpoint** `/awip-api/tenants/:id/purge` — hard-delete with a 30-day tombstone; emits `tenant_purged` event. Needs an admin approval gate.
- **Retention policy** — per-table TTL (`api_call_logs` 365d, `ai_usage_log` 90d, `*_events` forever). New `retention_policies` table + nightly cron.
- **Data-flow diagram** — single SVG in `docs/sovereignty.md` showing operator → edge function → DB, plus every egress arrow.
- **DPA template** — markdown in `docs/legal/dpa-template.md`.
- **Trust page** — public `/trust` route summarising region, sub-processors, last audit date.

## Workstream C — Tier 3 scope (research only)

Listed in `docs/sovereignty.md` as "Tier 3 backlog, not committed":

- CMK/BYOK — needs Supabase enterprise tier; document the gap.
- In-region AI mode — depends on the (separate) AI egress workstream; `pickModel()` would gain a `tenant.sovereignty='strict'` branch that refuses external models.
- Signed audit exports — sign export zips with an AWIP key so customers can prove non-tampering.
- Per-tenant sub-processor opt-in — `tenant_subprocessor_consents` table; service-token calls check it before invoking.
- ISO 27001 evidence pack — auto-generate from `docs/iso27001-controls.md` + `api_call_logs` extracts.

## Workstream D — Positioning (decide later, after Tier 1)

Three positioning options stay in `docs/sovereignty.md` as an explicit "not decided" section:

- **A. The USP.** Rewrite homepage + `master-plan.md` vision. Only after Tier 3.
- **B. One of three pillars.** Add to homepage alongside "operator-driven" and "capability-substrate". Viable after Tier 2.
- **C. Posture only.** Keep architecture, don't market. Viable today after Tier 1.

No homepage changes in this plan. The Index page stays as-is.

## Out of scope

- Any AI egress controls (separate workstream, user explicitly deferred).
- Any change to `pickModel()`, `ai_usage_log`, or model routing.
- Any homepage / marketing copy change.
- Any new RLS policies or auth flows.
- Encryption-at-rest changes.

## Deliverables of this plan, when implemented

1. `docs/sovereignty.md` (new) — Tier 1 posture, Tier 2 backlog, Tier 3 research, positioning options.
2. `docs/legal/` directory placeholder with a `README.md` explaining what goes there later.
3. `mem/preferences/sovereignty-posture.md` (new) — current tier + what's not claimed.
4. `README.md` + `docs/master-plan.md` link updates.
5. `CHANGELOG.md` entry under Unreleased.

No DB migrations. No edge functions. No UI.

## How we'd decide the next move

After Tier 1 ships, you have a doc you can show to a prospective buyer. Their reaction tells us whether to fund Tier 2. We don't speculatively build Tier 2/3 without that signal.
