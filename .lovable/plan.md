## Goal
Bring docs in sync with the Gemini TTS work and the Rork iPhone companion spec, then update README + CHANGELOG + memory per the project's doc rules.

## Files to create

1. **`docs/gemini-tts.md`** — reference doc for the new edge function
   - Endpoint: `POST /functions/v1/gemini-tts`
   - Auth: operator JWT (same as `companion-cloud-chat`)
   - Request body: `{ text, voice?, model? }` with the 8 supported prebuilt voices (Kore default, Puck, Charon, Aoede, Fenrir, Leda, Orus, Zephyr)
   - Response: `audio/wav` (24 kHz PCM, server-wrapped WAV header)
   - Logging: `ai_usage_log` rows with `job='gemini-tts'`, char count, latency
   - Cost ballpark (~$0.0001/sec) and night-window note (TTS bypasses `pickModel()`)
   - Browser test surface: `/admin → Gemini TTS preview`
   - Secret required: `GOOGLE_AI_API_KEY`

2. **`docs/rork-companion-spec.md`** — the iPhone companion spec we agreed
   - Scope: voice capture, approvals inbox, morning + night digest, discussion actions, all with voice + text
   - Auth: email/password (Supabase JS direct from the Expo app)
   - Push: APNs
   - Conversation mode: Gemini TTS online (default), `expo-speech` offline fallback, voice picker
   - Endpoints the app calls (read-only list with link to `docs/api.md` + `gemini-tts.md`)
   - What lives in the separate Rork Expo project vs this repo

## Files to update

3. **`mem/features/companion.md`**
   - Add Gemini TTS as default voice for both `/companion` (browser) and the iPhone surface
   - Note the 8 prebuilt voices + offline `expo-speech` fallback
   - Add a short "iPhone (Rork)" subsection pointing at `docs/rork-companion-spec.md`

4. **`README.md`**
   - Add `docs/gemini-tts.md` and `docs/rork-companion-spec.md` to the docs index section
   - Mention `gemini-tts` in the edge-function list if one exists there

5. **`CHANGELOG.md`** — new "Unreleased" entry:
   - Added: `gemini-tts` edge function (Gemini 2.5 Flash TTS, 8 voices, WAV output, `ai_usage_log` integration)
   - Added: `GeminiTtsTestPanel` on `/admin`
   - Added: `GOOGLE_AI_API_KEY` secret requirement
   - Added: docs `gemini-tts.md`, `rork-companion-spec.md`

6. **`mem://index.md`** — add a one-line memory reference:
   - `[Gemini TTS](mem://features/gemini-tts)` — endpoint, voices, cost, where it's wired

7. **`mem/features/gemini-tts.md`** (new memory file)
   - One-screen rule sheet: endpoint, default voice, secret name, log shape, "TTS skips night-cheap policy"

## Out of scope
- No code changes to `gemini-tts/index.ts` or `GeminiTtsTestPanel.tsx`
- No new tables, no cron, no edits to `companion-cloud-chat`
- The Rork Expo project itself (separate repo) — this only documents the contract

## GitHub
All of the above land in this Lovable project and auto-sync to the connected GitHub repo on save. Nothing manual needed on the git side.
