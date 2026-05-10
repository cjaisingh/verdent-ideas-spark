# Gemini TTS

Edge function that proxies Google's Gemini 2.5 Flash TTS and returns ready-to-play
WAV audio. Used by the browser `/companion` page (planned) and the Rork iPhone
companion app (see [`rork-companion-spec.md`](./rork-companion-spec.md)).

## Endpoint

`POST /functions/v1/gemini-tts`

**Auth:** operator JWT (`Authorization: Bearer <jwt>`). Same pattern as
`companion-cloud-chat`. No service-token path — TTS is operator-initiated only.

**Request body:**
```json
{
  "text": "Good morning. Three approvals waiting.",
  "voice": "Kore",
  "model": "gemini-2.5-flash-preview-tts"
}
```

| Field   | Required | Default                          | Notes                                        |
|---------|----------|----------------------------------|----------------------------------------------|
| `text`  | yes      | —                                | Plain text. No SSML.                         |
| `voice` | no       | `Kore`                           | One of the 8 prebuilt voices below.          |
| `model` | no       | `gemini-2.5-flash-preview-tts`   | Or `gemini-2.5-pro-preview-tts` (slower/$).  |

**Voices:** `Kore` (default, warm/natural), `Puck`, `Charon`, `Aoede`, `Fenrir`,
`Leda`, `Orus`, `Zephyr`. Anything else → `400 invalid_voice`.

**Response:** `audio/wav` (24 kHz mono 16-bit PCM, server-wrapped with a 44-byte
WAV header so iOS `expo-av` and the browser `<audio>` element play it directly).

## Logging

Every successful call writes one row to `ai_usage_log`:

```
job: 'gemini-tts'
model: <resolved model>
input_chars: text.length
latency_ms: <google round-trip>
request_ref: { voice, bytes }
```

Cost shows up on the existing AI vs Human cost widget on `/dashboard`.

## Cost

Gemini 2.5 Flash TTS bills around **$0.0001/sec** of generated audio.

| Workload                          | Approx daily cost |
|-----------------------------------|-------------------|
| 30s morning digest, once/day      | ~$0.003           |
| 50 conversations × 2 min/day      | ~$0.30            |

## Night-window policy

TTS bypasses `_shared/model-policy.ts → pickModel()`. The 22:00–06:00 UTC switch
to `google/gemini-2.5-flash-lite` only applies to reasoning models — the TTS
model is always whatever the request asked for (default `flash-preview-tts`).

## Secret

Requires `GOOGLE_AI_API_KEY` (direct Google AI Studio key, not via Lovable AI
Gateway — Gemini TTS models are not exposed through the gateway).

Stored in Lovable Cloud → Project secrets. Never in the repo, never in the
iPhone bundle.

## Browser test surface

`/admin → Gemini TTS preview` (`src/components/admin/GeminiTtsTestPanel.tsx`):
voice picker, text input, **Speak** button, plays via `new Audio()`, shows
latency + byte count. Use it to pick the default voice before the iPhone app
ships.

## Files

- `supabase/functions/gemini-tts/index.ts` — proxy + WAV wrapping + auth + logging
- `src/components/admin/GeminiTtsTestPanel.tsx` — browser preview
- `src/pages/Admin.tsx` — mounts the panel
