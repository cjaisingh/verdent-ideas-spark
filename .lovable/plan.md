# AWIP Companion — Local LLM Discussion Layer

A second "brain" that runs on your M4 Mac (Ollama) so you can talk through morning reviews, ad-hoc ideas, and AWIP decisions while Lovable keeps coding. The companion is read/discuss-heavy; Lovable stays the planner/coder. Anything worth acting on is promoted into `discussion_actions` (manual + auto-extract), so I pick it up next session via the existing Night Agent / roadmap path.

Phased so each phase is independently useful.

## Phase 1 — In-app Companion tab (fastest win)

Goal: usable today, when you're at the desk.

- New route `/companion` + sidebar entry, behind operator role.
- Chat UI built from AI Elements primitives (`Conversation`, `Message`, `MessageResponse`, `PromptInput`), per the chat-agent contract — no `Sparkles` mascot.
- Threaded conversations stored in two new tables:
  - `companion_threads` (id, title, agent_kind: `general|morning_review|planning`, model, created_by, created/updated_at)
  - `companion_messages` (id, thread_id, role, content, parts jsonb, model, latency_ms, escalated bool, created_at)
  - Operator-only RLS; realtime on both.
- Browser talks **directly** to `http://localhost:11434/v1/chat/completions` (Ollama is OpenAI-compatible). No edge-function hop, so it's free and zero-latency.
  - Setting on `/companion`: `OLLAMA_BASE_URL` (default `http://localhost:11434`), default model (e.g. `qwen2.5:14b-instruct`), fallback cloud model.
  - You set `OLLAMA_ORIGINS=https://*.lovable.app,http://localhost:*` once on the Mac.
- **RAG online**: each turn calls a new `awip-rag-query` edge function (or extends existing `awip-rag`) that runs `awip_rag_search()` over `awip_doc_chunks` and returns top-k chunks. Companion injects them as a system message. Always-fresh project knowledge.
- **Escalate to Lovable**:
  - Per-message "Promote → action" button → inserts a `discussion_actions` row (subject_type `companion_thread`, `night_eligible=true`, owner `lovable`).
  - "End & extract" button on a thread → reuses `discussion-extract-actions` against the thread transcript, writes proposed actions for you to approve.
- Morning-review pre-canned thread: button "Discuss today's plan" opens a thread seeded with the latest `daily_plans` + `morning_reviews` row + KPIs. Cron continues to draft (no change to existing job); the companion is just where you talk it through and record decisions back into `morning_reviews.acknowledged_*`.

Deliverable after Phase 1: you can chat to local Gemma/Qwen with full AWIP RAG context, log any decision, and hand me action items — all from the existing app.

## Phase 2 — Make it an installable PWA (phone/tablet/Mac dock)

Goal: same companion, off the main app, usable from iPhone/iPad/Mac dock.

- Manifest-only PWA (per Lovable PWA guidance — **no service worker**, no offline). Just `manifest.json`, icons, `display: standalone`, scoped to `/companion`.
- "Add to Home Screen" works on iOS/Android/macOS Safari. Same auth (Supabase magic-link), same RLS, same realtime — it's just the AWIP app launched scoped to `/companion`.
- Phone/tablet variant: when off your LAN, Ollama at `localhost` won't be reachable; add a simple per-device toggle "Use cloud model" that routes to `lovable-ai` Gateway (`gemini-2.5-flash-lite`) so you can still chat on the train.
- Local cache fallback for RAG: if the `awip-rag-query` call fails (offline), use a small cached `top-50 recent chunks` snapshot stored in IndexedDB, refreshed in background when online.

Deliverable after Phase 2: same companion as a real installable app on every device, gracefully degrades when off-LAN.

## Phase 3 — Headless local agent on the Mac (always-on, file-aware)

Goal: free Lovable from anything that can be done locally; let the Mac do work overnight.

- Tiny Deno daemon (`awip-companion-daemon/`) running on the Mac via `launchd` (always-on, restarts on crash). Single binary, no Docker.
- Polls a new `local_ai_jobs` table (operator + service-token RLS) every 10s for queued jobs. Jobs include:
  - `morning_review_draft` (replaces cron call when daemon is alive — saves the cloud call, falls back to cron after 5 min of no heartbeat)
  - `companion_async_chat` (long-running threads queued from the PWA when you're not on LAN — daemon completes them, push notifies via Telegram bot)
  - `rag_reindex` (re-embed `awip_docs` into a local LanceDB / SQLite-vss for offline use; richer than the Postgres tsvector RAG)
  - `file_import_summarize` (drop a file in a watched folder → daemon ingests, summarizes, attaches to a thread). This is the "investigate file imports and templates" leg you flagged.
- Daemon authenticates with `AWIP_SERVICE_TOKEN` and writes results back via `awip-api`. Heartbeat into a `local_agent_heartbeats` table → surfaced on `/overnight`.
- All daemon AI runs are `cost_usd = 0` and tagged `model: ollama:<name>` in `ai_usage_log` so the AI-vs-human card reflects savings.

Deliverable after Phase 3: morning review, file imports, and overnight chat work for free on the Mac; Lovable is left alone to code.

## Technical details

- **Schema (new tables, all operator-RLS + realtime):**
  - `companion_threads`, `companion_messages` — Phase 1
  - `local_ai_jobs (id, kind, payload jsonb, status, claimed_by, claimed_at, result jsonb, cost_usd, created_at, finished_at)` — Phase 3
  - `local_agent_heartbeats (host, last_seen_at, version, models jsonb)` — Phase 3
- **Edge functions (new):**
  - `awip-rag-query` — operator JWT, returns top-k chunks for a query (thin wrapper over `awip_rag_search()`).
  - `companion-extract-actions` — takes a `thread_id`, reuses prompt from `discussion-extract-actions`, writes `discussion_actions`.
- **Cost tracking:** companion turns logged to `ai_usage_log` with `job='companion'`, `model='ollama:<name>'`, `cost_usd=0`. Counts toward the AI-vs-human savings KPI on `/plan`.
- **Models on M4 24GB:** good fits — `qwen2.5:14b-instruct-q4_K_M` (best general), `llama3.1:8b-instruct` (fast), `gemma2:9b` (good summary). Picker in companion settings.
- **CORS on Ollama:** one-time `launchctl setenv OLLAMA_ORIGINS "https://*.lovable.app,http://localhost:*"` then restart Ollama.
- **Out of scope:** replacing Lovable for actual code edits, voice input on companion (we already have voice in Copilot — can be added later), training/fine-tuning.

## Suggested order

Build Phase 1 end-to-end first (≈1 session). Use it for a few days. Then Phase 2 (≈half session, mostly manifest + cloud-fallback toggle). Phase 3 (≈1–2 sessions) only after Phase 1 proves the workflow.

Want me to start with **Phase 1** as soon as you approve, or split it into smaller approval steps (chat tab → RAG → escalation → morning-review seed)?
---

## Build progress

### Phase 1 — In-app Companion tab — **shipped 2026-05-09**
- `companion_threads` + `companion_messages` tables (operator-owner RLS, realtime, 30-day retention on messages).
- `/companion` route + sidebar entry under **Plan**.
- Streaming chat from local Ollama via OpenAI-compatible `/v1/chat/completions`.
- RAG context per turn via existing `awip-rag/search` (top-k from `awip_doc_chunks`).
- Per-message **Promote → action** (writes `discussion_actions` row, `night_eligible=true`, owner `lovable`, subject_type `companion_thread`).
- **Extract actions** button on a thread (new `companion-extract-actions` edge fn, mirrors `discussion-extract-actions`).
- Morning-review seeded thread button (pulls latest `daily_plans` + `morning_reviews`).
- Settings dialog: Ollama base URL, local model, RAG toggle, cloud-fallback toggle (cloud routing **not wired yet** — toast warns).

**Operator setup (one-time on the Mac):**
```
launchctl setenv OLLAMA_ORIGINS "https://*.lovable.app,http://localhost:*"
ollama serve   # or restart Ollama.app
ollama pull qwen2.5:14b-instruct
```

### Phase 1.5 — Cloud fallback (small, next)
Wire a real cloud LLM proxy edge fn (`companion-chat`) so the "Use cloud" toggle actually streams from Lovable AI Gateway. Needed for phone/tablet use when off-LAN.

### Phase 2 — PWA manifest
### Phase 3 — Headless Mac daemon + `local_ai_jobs`
