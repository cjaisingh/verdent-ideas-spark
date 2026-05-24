# ISO/IEC 42001 gap analysis

Internal gap analysis of AWIP Core against ISO/IEC 42001:2023 (AI Management System — AIMS). **Not** a certification claim, not marketing. Companion to [`iso27001-controls.md`](./iso27001-controls.md) (ISMS view) and [`sovereignty.md`](./sovereignty.md) (data residency + egress).

Scope: every AI-touching surface in AWIP Core today. Excludes the Rork iPhone Companion (separate project) and any future in-region AI workstream — see [`sovereignty.md`](./sovereignty.md) Tier 3.

## 1. AI surface inventory

Single source of truth for "what AI runs in AWIP". Any new AI surface must add a row in the same change.

| Surface | Entry point | Model policy | Egress | Logging | Oversight |
|---|---|---|---|---|---|
| Companion (browser + Rork) | `companion-cloud-chat` | Lovable AI Gateway, night-cheap via `pickModel()` | Gemini / OpenAI | `ai_usage_log`, `companion_messages` | operator-review |
| Copilot voice | `/copilot` + Deepgram STT | Gateway + Deepgram | Gemini / OpenAI / Deepgram | `ai_usage_log`, `voice_*` | operator-review |
| Gemini TTS | `gemini-tts` | Bypasses night-cheap (TTS-only) | Google | `ai_usage_log` | system-auto |
| Night Agent | `night-agent-open` / `night-agent-close` | Forced `gemini-2.5-flash-lite` 22:00–06:00 UTC | Google | `night_shifts`, `ai_usage_log` | operator-approve (morning) |
| Overnight phase runner | `overnight-phase-runner-15m`, `overnight-prequeue` | Night-cheap | Gemini | `roadmap_phase_overnight_runs` | operator-approve (morning) |
| Overnight recommender | `scheduled-overnight-recommender` | SQL-only, no LLM | — | `discussion_actions` | operator-approve |
| Morning Review | `scheduled-morning-review` | Gateway | Gemini / OpenAI | `morning_reviews`, `ai_usage_log` | operator-review |
| Lessons Loop | `scheduled-lessons-daily/weekly` | Gateway | Gemini / OpenAI | `lessons`, `ai_usage_log` | operator-approve |
| Deep Audit | `scheduled-deep-audit-weekly/monthly` | Gateway | Gemini / OpenAI | `audit_runs`, `ai_usage_log` | operator-review |
| Sentinel tick | `scheduled-sentinel-tick` | SQL + light LLM | Gemini | `sentinel_findings` | sentinel-watch |
| Code review | `scheduled-code-review` | Gateway | Gemini / OpenAI | `code_review_runs` | operator-review |
| QA validate | `qa-validate` | Gateway | Gemini | `qa_check_events` | operator-approve |
| App walkthrough | `scheduled-app-walkthrough` | Gateway | Gemini | `sentinel_findings` | sentinel-watch |
| AWIP reviews pull | `scheduled-awip-reviews-pull` | RAG only | GitHub | `awip_reviews`, `sentinel_findings` | operator-review |
| HeyGen videos | `/admin/videos` | HeyGen | HeyGen US | `heygen_videos` | operator-approve |
| Telegram routing | `telegram-webhook`, `operator-inbox-classify` | Gateway | Gemini | `inbox_items`, `telegram_gateway_logs` | operator-review |
| Entity resolver embedding-hint | `entity-resolve` `/resolve` | pgvector + Gemini embeddings | Google (embeddings only) | `entity_resolution_events` | operator-approve (high-conf auto-binds excluded) |

Oversight values: `operator-approve` (human gate before effect), `operator-review` (visible after the fact in Morning Review or Inbox), `system-auto` (no human in the loop by design), `sentinel-watch` (anomaly-driven nudges only).

All surfaces route through `_shared/model-policy.ts → pickModel()` except where noted. All write to `ai_usage_log` (cost + tokens) per [credits & usage](./credits-usage.md).

## 2. Clause-by-clause status (ISO/IEC 42001 §4–10)

| Clause | Title | Status | Current AWIP evidence |
|---|---|---|---|
| 4 | Context of the organisation | **partial** | `docs/why-awip.md`, `docs/architecture.md`. No formal AI scope statement separating AIMS from ISMS. |
| 5 | Leadership & AI policy | **gap** | No written, signed AI policy. Operator-as-sole-leader assumed but undocumented. |
| 6 | Planning (AI risk + AIIA) | **gap** | No AI Impact Assessment template; no per-surface AIIA. Generic risk surfaces via `sentinel_findings` only. |
| 7 | Support (resources, competence, awareness) | **partial** | `docs/development.md`, `AGENTS.md`, agent persona files in `docs/agents/team/`. No AI-specific competence record. |
| 8 | Operation (lifecycle, third-party) | **partial** | `pickModel()`, `tool_policy_rules`, [`tool-policy.md`](./tool-policy.md), sub-processor list in [`sovereignty.md`](./sovereignty.md) §5. No AI-lifecycle SOP. |
| 9 | Performance evaluation | **partial** | `ai_usage_log`, [budget alerts](./budget-alerts.md), sentinel, deep-audit weekly/monthly, [credits & usage](./credits-usage.md). No AI-specific internal audit. |
| 10 | Improvement | **partial** | `lessons` table, post-mortems (`mem/features/postmortems.md`). No AI-specific nonconformity register. |

## 3. Annex A control mapping (selected)

Annex A of ISO/IEC 42001 enumerates AIMS controls. Only controls relevant to AWIP today are listed; the rest are not applicable (no model training, no biometric processing, no automated decisioning over data subjects).

| Control | Topic | AWIP coverage | Gap |
|---|---|---|---|
| A.2 | AI policy | — | **gap** — no written policy |
| A.3 | Internal organisation / roles | `user_roles` + `has_role()`, [security.md](./security.md) | partial — no AIMS-specific role |
| A.4 | Resources for AI systems | `tool_policy_rules`, `credit_settings`, `pickModel()` | covered |
| A.5 | Assessing impact of AI systems | — | **gap** — no AIIA |
| A.6 | AI system lifecycle | Migrations, `docs/architecture.md`, [ci-cd.md](./ci-cd.md), ADRs in `docs/adr/` | partial — no AI-specific change record |
| A.7 | Data for AI systems | RAG sources documented in [awip-rag.md](./awip-rag.md); no training data | covered (we do not train) |
| A.8 | Information for interested parties | `/sovereignty`, `/trust`, this doc | partial — operator-internal only |
| A.9 | Use of AI systems | [companion.md](../mem/features/companion.md), [playbooks/voice-and-chat-first.md](./playbooks/voice-and-chat-first.md) | partial — no human-oversight matrix |
| A.10 | Third-party relationships | Sub-processor list in [sovereignty.md](./sovereignty.md) §5 | partial — no AI-specific DPA review |

## 4. Gap log (prioritised)

In order of effort-to-value for a future AIMS claim:

1. **AI policy doc** (Cl.5, A.2) — one page, signed. Cheap, unblocks everything else.
2. **Human-oversight matrix per surface** (A.9) — extend §1 table with `oversight: autonomous | operator-in-loop | operator-approve`. Mostly documentation of existing reality (Night Agent autonomous within `night_eligible=true`; everything else operator-in-loop).
3. **AIIA template + per-surface assessment** (Cl.6, A.5) — short template under `docs/aiia/`; one assessment per row in §1.
4. **Third-party AI DPA / AIA review** (A.10) — Gemini, OpenAI, Deepgram, HeyGen. Cross-check against `docs/legal/sub-processor-list.md`.
5. **No-training statement** (A.7) — explicit doc that AWIP does not train models on operator data and that gateway providers are configured `data_use=opt_out` where the provider exposes it.
6. **AI-specific incident classification** (Cl.10) — extend `sentinel_findings` taxonomy or add `ai_incident_class` column.
7. **Periodic AI-system review cadence** (Cl.9) — beyond `deep-audit`, an annual AIMS review of §1 and §3.

## 5. Out of scope

- Certification or third-party audit.
- Drafting the AI policy itself — listed as gap #1.
- Implementing the AIIA template or running per-surface assessments — gap #3.
- In-region AI / constraining AI egress — see [`sovereignty.md`](./sovereignty.md) Tier 3.
- Customer-facing AI claims or `/trust` page changes.
- Updating `mem/preferences/sovereignty-posture.md` — sovereignty tier unchanged.

## 6. How to keep this honest

1. Any new AI surface added to AWIP **must** add a row to §1 in the same change.
2. Any change to model policy (`pickModel()`, `tool_policy_rules`) **must** update §1 and re-check §3 A.4.
3. Any new third-party AI provider **must** update §3 A.10 *and* `docs/sovereignty.md` §5 in the same change.
4. When a gap in §4 is closed, move it to §3 with the evidence path; do not delete the gap line — strike it through and link the closing change.
