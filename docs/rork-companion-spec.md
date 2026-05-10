# Rork iPhone Companion — Spec

The iPhone app is a **separate Rork (Expo) project**. This doc is the contract
between AWIP Core (this repo) and that app. No iPhone code lives in this repo.

## Scope (v1)

- **Voice capture** — hold-to-record, transcribe, drop into a thread.
- **Approvals inbox** — pending `approval_queue` rows, approve / reject from phone.
- **Morning + Night digest** — read the latest `morning_reviews` row + tonight's
  `night_shifts` summary, optionally spoken aloud.
- **Discussion actions** — list open `discussion_actions`, mark done, promote.
- **Conversation mode** — back-and-forth voice + text with the operator agent.

Everything works in both **voice** and **text** input modes.

## Auth

- **Email / password** via Supabase JS direct from the Expo app.
- Operator must already have an `operator` or `admin` row in `user_roles`
  (signup is bootstrap-only via `bootstrap_first_operator()`; the iPhone app
  is sign-in only — no signup screen).
- Tokens stored in `expo-secure-store`.

## Push

- **APNs** via Expo push tokens. Token registered to a new
  `operator_push_tokens` table (operator-only RLS) on first login.
- Push triggers (server-side, follow-up work):
  - new pending `approval_queue` row,
  - new high-severity `sentinel_findings` row,
  - daily `morning_reviews` write (06:00 UTC, optional, opt-in).

## Surface

- **Supabase JS direct** — the app talks to the same Postgres + edge functions
  this repo exposes. No iPhone-specific BFF.
- All RLS policies already cover the operator-only tables; no new policies
  needed for the iPhone surface.

## Conversation mode

- **Online (default):** `POST /functions/v1/gemini-tts` (operator JWT) →
  stream the returned WAV into `expo-av` `Audio.Sound`. See
  [`gemini-tts.md`](./gemini-tts.md) for voices, cost, logging.
- **Offline fallback:** `expo-speech` (system iOS voice) when network fails or
  the user toggles **Data saver** in Settings.
- **Voice picker** in iPhone Settings: 8 prebuilt Gemini voices + "System voice".
  Default `Kore`.
- **Speech-to-text:** `expo-speech-recognition` on-device (free, no key) for v1.
  Cloud STT (Deepgram, already wired into `/copilot`) is a v2 option.

## Endpoints the iPhone app calls

| Method | Path                                            | Purpose                          |
|--------|-------------------------------------------------|----------------------------------|
| POST   | `/functions/v1/gemini-tts`                      | Speak text via Gemini voices     |
| POST   | `/functions/v1/companion-cloud-chat`            | Cloud chat turn (Lovable AI)     |
| POST   | `/functions/v1/companion-extract-actions`       | Pull actions out of a thread     |
| POST   | `/functions/v1/awip-rag` (`/search`)            | RAG search over project docs     |
| —      | Direct Supabase reads/writes (RLS-gated)        | `approval_queue`, `discussion_actions`, `morning_reviews`, `night_shifts`, `companion_threads`, `companion_messages` |

Full endpoint reference: [`api.md`](./api.md).

## What lives where

| Concern                        | This repo                               | Rork Expo project        |
|--------------------------------|-----------------------------------------|--------------------------|
| Edge functions, RLS, schema    | ✅                                      | —                        |
| Operator console (web)         | ✅                                      | —                        |
| iPhone screens / native code   | —                                       | ✅                       |
| Push token registration table  | ✅ (`operator_push_tokens`, planned)    | sends token on login     |
| APNs cert + Expo project       | —                                       | ✅                       |

## Settings stored on the device

- `gemini_voice` (default `Kore`)
- `data_saver` (boolean — forces `expo-speech` fallback)
- `push_enabled` (boolean)
- `morning_digest_push` (boolean, opt-in)
- Supabase URL + anon key — pasted from this project's `.env` into Expo `app.config.ts`.

## Out of scope for v1

- Note capture beyond voice → thread (no rich-text editor).
- Roadmap browsing (use the web console).
- Any write to OKR / capability tables (read-only on those for now).
- Cloud STT (uses on-device speech recognition only).
