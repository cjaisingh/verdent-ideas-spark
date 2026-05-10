---
name: Gemini TTS
description: gemini-tts edge function — Google AI Studio TTS, 8 voices, returns audio/wav, logged to ai_usage_log
type: feature
---
**Endpoint:** `POST /functions/v1/gemini-tts` (operator JWT only).
**Body:** `{ text, voice?='Kore', model?='gemini-2.5-flash-preview-tts' }`.
**Voices (8 prebuilt):** `Kore` (default), `Puck`, `Charon`, `Aoede`, `Fenrir`, `Leda`, `Orus`, `Zephyr`.
**Response:** `audio/wav`, 24 kHz mono 16-bit PCM, server-wrapped with WAV header so `expo-av` + browser `<audio>` play it directly.
**Secret:** `GOOGLE_AI_API_KEY` (direct Google AI Studio — NOT Lovable AI Gateway; TTS models aren't exposed there).
**Logging:** every call writes `ai_usage_log` with `job='gemini-tts'`, `model`, `input_chars=text.length`, `latency_ms`, `request_ref={voice,bytes}`.
**Cost:** ~$0.0001/sec audio. 30s digest ≈ $0.003. Heavy day (50 × 2 min) ≈ $0.30.
**Night policy:** TTS bypasses `pickModel()` — the 22:00–06:00 UTC night-cheap switch only applies to reasoning models.
**Browser test:** `/admin → Gemini TTS preview` (`src/components/admin/GeminiTtsTestPanel.tsx`).
**Consumed by:** Rork iPhone companion (default voice, online), browser `/companion` (planned). Offline fallback on iPhone is `expo-speech`.
**Doc:** `docs/gemini-tts.md`. iPhone spec: `docs/rork-companion-spec.md`.
