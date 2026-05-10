# Gemini TTS for the Rork iPhone Companion

## ⚠️ Rotate the key first
The key `AIzaSy…OV1M` was pasted in plaintext chat. Before we wire anything, **revoke it in Google AI Studio → API keys** and generate a fresh one. I'll request the new value through the secure secrets form (never typed in chat) so it lands in the backend env as `GOOGLE_AI_API_KEY` and never touches the repo or the iPhone bundle.

## What we're adding

1. **`GOOGLE_AI_API_KEY` secret** — stored server-side only. The iPhone app never sees it.
2. **New edge function `gemini-tts`** (`supabase/functions/gemini-tts/index.ts`)
   - Auth: operator JWT (same pattern as `companion-cloud-chat`)
   - Input: `{ text: string, voice?: string, model?: string }`
   - Calls `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent` with `responseModalities: ["AUDIO"]` and the chosen prebuilt voice (default `Kore` — natural, warm; alternates `Puck`, `Charon`, `Aoede`).
   - Returns `audio/wav` (24 kHz PCM from Gemini, wrapped with a WAV header server-side so iOS `expo-av` plays it directly).
   - Logs to `ai_usage_log` with `job: "gemini-tts"`, `model`, char count, latency — same shape as other AI jobs.
   - Night-window policy does **not** apply (TTS isn't a reasoning model); always uses the flash-preview-tts model.
3. **Spec update (§Conversation mode)** — change default from "system TTS" to:
   - **Online (default):** call `POST /functions/v1/gemini-tts` from the iPhone app, stream the wav into `expo-av` `Audio.Sound`.
   - **Offline fallback:** `expo-speech` (iOS system voice) when network fails or user toggles "Data saver".
   - Voice picker in iPhone Settings: 4 prebuilt Gemini voices + "System voice".
4. **Web preview button** — add a tiny "Test voice" button on `/admin` (AppSecretsPanel-style) so you can hear the output from the browser before the iPhone app ships. Useful for picking the default voice.

## Cost ballpark
Gemini 2.5 Flash TTS is ~$0.0001/sec of audio. A 30-sec spoken digest = ~$0.003. A heavy day (50 conversations, ~2 min each) ≈ $0.30. Logged per-call to `ai_usage_log` so it shows up in the existing AI vs Human cost widget on the dashboard.

## What I will NOT change
- No edits to `companion-cloud-chat` (text streaming stays as-is)
- No edits to existing `_shared/model-policy.ts` night logic
- No new tables — usage rides on `ai_usage_log`
- No iPhone-side code in this repo (Rork app lives in your separate Expo project; you'll paste the function URL + voice list into its config)

## Files to create/edit
- `supabase/functions/gemini-tts/index.ts` (new, ~120 lines)
- `src/components/admin/GeminiTtsTestPanel.tsx` (new, small)
- `src/pages/Admin.tsx` (mount the test panel)
- `mem/features/companion.md` (note Gemini TTS as default)
- update the Rork spec doc with the new conversation-mode section + voice list

## Open question before I implement
Do you want me to **also** wire Gemini TTS into the existing browser `/companion` page (so you can talk to it from the Mac with natural voice), or keep it iPhone-only for now?
