---
name: AWIP Companion
description: Local-LLM discussion layer at /companion — Ollama on Mac, RAG via awip-rag, escalates to Lovable via discussion_actions
type: feature
---
**What it is:** Browser-side chat UI at `/companion` that streams from local Ollama (`http://localhost:11434/v1/chat/completions`) so the operator can think out loud / do morning reviews without spending Lovable's coding turns.

**Tables (operator-owner RLS, realtime, both added to `supabase_realtime` publication):**
- `companion_threads` (title, agent_kind: general|morning_review|planning, model, created_by, archived_at, seed_payload)
- `companion_messages` (thread_id, role, content, model, latency_ms, escalated_action_id, rag_chunk_ids)
- 30-day retention on `companion_messages` via `retention_settings`.

**RAG:** each user turn calls `POST /functions/v1/awip-rag/search { q, limit: 6 }` and injects results as a system message. Browser uses operator JWT, no service token.

**Cloud cost = 0 for local turns.** Local model name stored as `model` on the message; not logged to `ai_usage_log` (no edge hop). Only the extract-actions and any cloud-fallback turn incur cost.

**Escalation to Lovable:**
- Per-message "Promote": inserts `discussion_actions` row with `subject_type='companion_thread'`, `subject_id=<thread.id>`, `night_eligible=true`, `owner='lovable'`, `source='manual'`.
- Thread-level "Extract actions" button: `POST /functions/v1/companion-extract-actions { thread_id }` — mirrors `discussion-extract-actions`, writes proposals with `source='extracted'`.

**Settings (localStorage `awip.companion.settings.v1`):** `ollama_base_url`, `ollama_model` (default `qwen2.5:14b-instruct`), `cloud_model`, `use_cloud` (cloud routing NOT wired in Phase 1), `rag_enabled`, `rag_top_k`.

**Mac one-time setup:** `launchctl setenv OLLAMA_ORIGINS "https://*.lovable.app,http://localhost:*"` then restart Ollama.

**Voice (TTS):** Default is **Gemini TTS** via `POST /functions/v1/gemini-tts` (8 prebuilt voices, default `Kore`, returns `audio/wav`). See `mem://features/gemini-tts` and `docs/gemini-tts.md`. Browser `/companion` will adopt it; iPhone Rork app uses it by default with `expo-speech` as offline fallback.

**iPhone (Rork) surface:** Separate Expo project. Talks to the same Supabase + edge functions via Supabase JS direct. Email/password auth, APNs push, voice + text everywhere. Full contract: `docs/rork-companion-spec.md`.

**Phase status:**
- Phase 1 ✅ shipped 2026-05-09 (local-only chat, RAG, escalation, morning-review seed)
- Phase 1.5 — wire real cloud fallback edge fn (`companion-chat` → Lovable AI Gateway)
- Phase 2 — manifest-only PWA scoped to `/companion`
- Phase 3 — headless Mac daemon + `local_ai_jobs` queue
- Phase 4 (in progress) — Rork iPhone companion + Gemini TTS as default voice
