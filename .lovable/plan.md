
# Plan — ISO 42001 gap-analysis stub

Create one new doc, link it from the two places that govern compliance posture. No code, no schema, no marketing.

## Deliverable

**`docs/iso42001-gap-analysis.md`** (~150 lines, under the 200-line doc cap).

Structure mirrors `docs/iso27001-controls.md` so the two can be read side-by-side:

1. **Header & scope** — Internal gap analysis only. Not a certification claim. AIMS = AI Management System per ISO/IEC 42001:2023. Cross-links to `docs/sovereignty.md`, `docs/iso27001-controls.md`, `docs/security.md`.
2. **Current AI surface inventory** — table of every AI-touching surface in Core today, with model policy, egress, logging table:
   - Companion (`companion-cloud-chat`) — Lovable AI Gateway, `ai_usage_log`
   - Copilot (`/copilot` + Deepgram STT)
   - Gemini TTS (`gemini-tts`) — bypasses night-cheap policy
   - Night Agent (`night-agent-*`) — forced to `gemini-2.5-flash-lite` 22:00–06:00 UTC via `pickModel()`
   - Overnight phase runner, overnight recommender
   - Morning review, lessons-loop, deep-audit (weekly/monthly)
   - Sentinel tick (LLM-assisted checks)
   - Code review (`scheduled-code-review`)
   - QA validate, app walkthrough
   - AWIP reviews pull (RAG fan-out)
   - HeyGen video generation
   - Telegram bot LLM routing
   - Entity resolver embedding-hint (s5.3 M3)
3. **Clause-by-clause gap table** — ISO/IEC 42001 clauses 4–10 mapped to current AWIP evidence and gap status (`covered` / `partial` / `gap`):
   - Cl.4 Context — partial (`docs/why-awip.md`, no formal AI scope statement)
   - Cl.5 Leadership & AI policy — gap (no signed AI policy doc)
   - Cl.6 Planning (AI risk + impact assessment) — gap (no AIIA template)
   - Cl.7 Support (resources, competence, awareness) — partial (`docs/development.md`)
   - Cl.8 Operation (AI system lifecycle, third-party) — partial (`pickModel()`, `tool_policy_rules`, sub-processor list)
   - Cl.9 Performance evaluation (monitoring, internal audit) — partial (`ai_usage_log`, sentinel, deep-audit, budget-alerts)
   - Cl.10 Improvement (nonconformity, corrective action) — partial (`lessons` table, post-mortems)
4. **Annex A control mapping** — selected controls relevant to AWIP today:
   - A.2 AI policy · A.3 Internal org / roles · A.4 Resources (data, tooling, system) · A.5 Impact assessment · A.6 AI system lifecycle · A.7 Data for AI systems · A.8 Information for interested parties · A.9 Use of AI systems · A.10 Third-party relationships
   - Each row: AWIP coverage + evidence path + gap flag.
5. **Gap log (prioritised)** — explicit list of what's missing to make a defensible AIMS claim. Top items:
   - No written AI policy
   - No AI Impact Assessment (AIIA) template or per-surface AIIA
   - No documented human-oversight matrix per surface (operator-in-the-loop vs autonomous)
   - No third-party AI provider DPA/AIA review (Gemini, OpenAI, Deepgram, HeyGen)
   - No data-quality / training-data statement (we don't train, but must say so)
   - No incident classification specific to AI (`sentinel_findings` is generic)
   - No periodic AI-system review cadence beyond `deep-audit`
6. **Out of scope** — certification, AIIA implementation, AI policy drafting, in-region AI workstream (deferred — see `docs/sovereignty.md` Tier 3), customer-facing AI claims.
7. **How to keep this honest** — same rules as `docs/sovereignty.md`: any new AI surface must update the §2 inventory in the same change.

## Wiring

- **`docs/iso27001-controls.md`** — add one line under header linking to the new 42001 doc as a sibling AIMS view.
- **`mem/index.md`** — add one-line entry under `## Memories` pointing to the new doc (reference, not memory file — no separate `mem/` entry needed; doc cap and one-line index entry is enough per `mem/preferences/doc-hygiene.md`).
- **`CHANGELOG.md`** — single line: `Added ISO 42001 gap-analysis stub (docs/iso42001-gap-analysis.md).`

## Out of scope for this plan

- Drafting the AI policy itself (Cl.5 gap).
- Building an AIIA template or running one per surface.
- Any code, migration, edge function, RLS change.
- Updating `mem/preferences/sovereignty-posture.md` — sovereignty tier unchanged.
- Marketing or `/trust` page changes.

## Validation

- `wc -l docs/iso42001-gap-analysis.md` ≤ 200.
- New doc renders; cross-links resolve.
- No CI gates touched (pure doc add).
