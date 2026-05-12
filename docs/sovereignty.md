# Data Sovereignty

This document is the honest, up-to-date statement of where AWIP Core data lives, who can read it, what leaves the region, and what we would have to build before we could legitimately *sell* sovereignty as a product property.

It is not marketing copy. It is the source-of-truth that marketing copy (if we ever write any) must be consistent with.

Cross-links: [`security.md`](./security.md) · [`architecture.md`](./architecture.md) · [`iso27001-controls.md`](./iso27001-controls.md) · in-app FAQ at `/sovereignty`.

---

## Current tier: **Tier 1 — Posture**

We have the architectural posture for a sovereignty story but we **do not** make any contractual or marketed sovereignty claim. Tiers 2 and 3 below describe what would be needed to escalate that claim.

The current tier and what is intentionally *not* claimed is also recorded in `mem://preferences/sovereignty-posture`.

---

## 1. Where your data lives

- **Primary region:** `eu-west-1` (AWS Ireland), via Lovable Cloud (Supabase). Confirmed from the project's connection string: `aws-0-eu-west-1.pooler.supabase.com`.
- **Replication:** none beyond the platform-managed multi-AZ replication inside `eu-west-1`. No cross-region replicas.
- **Backups:** managed by Lovable Cloud / Supabase platform; retained inside the same region.
- **Tenant model:** all tenants share the same Postgres database, isolated by `tenant_id` columns and RLS. There is **no per-tenant database**, no per-tenant region today.

If you need a region other than `eu-west-1`, we cannot offer it today. Adding a second region is a Tier 2/3 workstream below.

## 2. Who can read it

Full detail is in [`security.md`](./security.md). Summary:

- Three identity classes: anonymous browser, operator user (Supabase JWT + `user_roles`), sibling project (`x-awip-service-token`).
- Every public-schema table has RLS enabled. Default is operator-only read; clients cannot write at all (the `tenants` table is the single intentional exception).
- All writes go through the `awip-api` edge function with a service-role DB client. No client ever holds the service role key.
- Roles live in `public.user_roles`, gated by `has_role()` (SECURITY DEFINER, pinned `search_path`).

## 3. What we record

Everything is append-only and operator-readable:

| Stream | Table | Retention today | Notes |
|---|---|---|---|
| API calls | `api_call_logs` | unlimited | route, status, duration, actor, idempotency replay flag |
| OKR mutations | `okr_node_events` | unlimited | every change to the OKR tree |
| Capability mutations | `capability_events` | unlimited | every manifest change |
| AI calls | `ai_usage_log` | unlimited | model, tokens in/out, cost, route |
| Telegram I/O | `telegram_gateway_logs` | unlimited | inbound + outbound messages |

Retention is currently "forever". A retention policy is part of the Tier 2 backlog.

## 4. What leaves the region (egress, today)

We are honest about this rather than handwaving. Today, the following data leaves `eu-west-1`:

| Destination | Purpose | Data class | Region |
|---|---|---|---|
| Google AI Studio (Gemini) | Operator AI features (Companion, Copilot, summarisation, code review, lessons synthesis, sentinel) | Operator prompts + relevant context (OKR titles, finding text, code snippets, transcripts) | Google global, US-default |
| OpenAI | Same set of features when an OpenAI model is selected | Same as above | OpenAI global, US-default |
| GitHub (`cjaisingh/verdent-ideas-spark`) | Source mirror; CI runs against this mirror | Full source code + edge function code | GitHub global |
| GitHub (`cjaisingh/verdent-ideas-spark/docs/reviews`) | Weekly AWIP review pull (Mon 05:30 UTC) | Review markdown only (read-only pull) | GitHub global |
| Telegram | Operator messaging gateway | Operator messages routed through the bot | Telegram global |
| Deepgram | Voice transcription for Companion when Deepgram path is used | Microphone audio + transcript | Deepgram US |

Everything else — operator UI traffic, database reads/writes, cron jobs, edge functions — stays inside `eu-west-1`.

The single biggest sovereignty leak is **AI calls**. Constraining or eliminating that is its own workstream and is intentionally **out of scope** for this document. When that workstream lands, this section will be revised.

## 5. Sub-processors

| Sub-processor | Purpose | Region | Data class |
|---|---|---|---|
| Lovable Cloud (Supabase) | Database, auth, edge functions, storage | `eu-west-1` | All operator data |
| Google AI (Gemini) | LLM for AI features | Google global | Prompts + context |
| OpenAI | LLM for AI features | OpenAI global | Prompts + context |
| GitHub | Source mirror + CI | GitHub global | Source code |
| Telegram | Operator messaging | Telegram global | Operator messages |
| Deepgram | Voice transcription (optional) | Deepgram US | Audio + transcripts |
| Lovable | Hosting + preview environments | Lovable infra | All operator data |

This list is the source of truth. Any new external service added to the codebase must update this table in the same change. After editing, run `bun run subprocessors:generate` to refresh [`docs/legal/sub-processor-list.md`](./legal/sub-processor-list.md); CI (`doc-drift`) blocks the PR if it goes stale.

---

## Tier 2 — Contractual (backlog, not committed)

What we'd add to make a defensible sovereignty claim that survives a procurement-team questionnaire.

- **Per-tenant region field.** `tenants.region text not null default 'eu-west-1'` plus a write-time check that no cross-region writes happen. Today single-region, so it's a label; becomes meaningful when we add a second region.
- **Export endpoint.** `POST /awip-api/tenants/:id/export` returning a signed zip of every row for the tenant across every table. Backed by a `tenant_export_jobs` table and a new edge function. Idempotent via `Idempotency-Key`.
- **Delete endpoint.** `POST /awip-api/tenants/:id/purge` performing a hard-delete with a 30-day tombstone. Emits `tenant_purged` event. Gated by an admin approval.
- **Retention policy.** New `retention_policies` table + nightly cron prunes `api_call_logs` (365d), `ai_usage_log` (90d). `*_events` stay forever (they are the audit log of record).
- **Data-flow diagram.** Single SVG embedded in this doc showing operator → edge function → DB plus every egress arrow.
- **DPA template.** Markdown in `docs/legal/dpa-template.md`.
- **Trust page.** Public `/trust` route summarising region, sub-processors, last audit date.

Rough size: ~1 sprint, no AI egress changes.

---

## Tier 3 — Sovereign-grade (research only, not committed)

What sellable-to-regulated-buyers would require. None of this is funded today.

- **CMK / BYOK.** Customer-managed encryption keys. Needs Supabase enterprise tier; document the exact gap when we get there.
- **In-region AI mode.** Depends on the (separate) AI egress workstream. `pickModel()` would gain a `tenant.sovereignty='strict'` branch that refuses external models and degrades the affected features.
- **Signed audit exports.** Sign export zips with an AWIP key so the customer can prove non-tampering.
- **Per-tenant sub-processor opt-in.** `tenant_subprocessor_consents` table; service-token calls check it before invoking each external sub-processor.
- **ISO 27001 evidence pack.** Auto-generate from `docs/iso27001-controls.md` + `api_call_logs` extracts.

Rough size: multi-sprint. Predicated on the AI egress workstream being done first.

---

## Positioning (not decided)

When (and if) we choose to externalise this story, three options exist. None is chosen today.

- **A. The USP.** Rewrite the homepage and `master-plan.md` vision around sovereignty. Only viable after Tier 3.
- **B. One of three pillars.** Add to the homepage alongside "operator-driven" and "capability substrate". Viable after Tier 2.
- **C. Posture only.** Keep the architecture, never market it. Viable today after Tier 1.

The decision belongs to whoever is talking to the first prospective buyer.

---

## How to keep this document honest

1. Any new external service added to the codebase **must** update §5 in the same change.
2. Any change to where data lives or replicates **must** update §1 in the same change.
3. Any new operator-facing claim about sovereignty **must** match what is written here.
4. When tiers change (e.g. Tier 2 ships), update the "Current tier" line at the top **and** `mem://preferences/sovereignty-posture`.
