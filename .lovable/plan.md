# Plan — phases 2-4 closed

_Updated after the cleanup pass. Live state on `/roadmap`._

## Decisions self-approved (per your message)
1. **Telegram module shape** → option (1): keep `telegram-*` + `route-operator-message` + `operator_messages`/`activity_policies`/`approval_queue` in Core. Same project, namespaced. No cutover needed.
2. **Voice transcription** → Gemini 2.5 Flash via Lovable AI Gateway. No extra key.

## What landed this pass
- **Voice ingest in `telegram-webhook`** — detects `message.voice` / `message.audio`, downloads via gateway `getFile` + `/file/`, base64-encodes, calls `ai.gateway.lovable.dev` with `input_audio` block on `google/gemini-2.5-flash`. Transcript is stored as the message text and routes through the normal `route-operator-message` → classify → `approval_queue` → Telegram approve/reject flow. If transcription fails, the bot replies asking the operator to type. Auto-logged via `roadmap-log-work`.
- **Approval callback wiring (s2.3 t1)** — webhook callback button now POSTs through `awip-api /approvals/{id}/decide`, which fires `callback_url` and `capability_events.approval_decided`. Falls back to direct DB update if the contract surface is unreachable, so approvals are never stuck.
- **Idempotency (s2.3 t2)** — already enforced: `operator_messages.update_id` is the primary key, upserted on every webhook hit.
- **Cutover (s3.1)** — no-op given decision (1). Webhook URL stays where it is. `docs/modules.md` updated to declare `operator_channel.telegram` and `operator_channel.voice_transcription` as Core capabilities.
- **Roadmap statuses** — s2.2, s2.3, s3.1, s4.1 all `done`; phase-3 and phase-4 marked `done`.

## Roadmap state
- **Phase 1** done.
- **Phase 2** active — only s2.4 hygiene remaining.
- **Phase 3** done.
- **Phase 4** done.

## Outstanding under Phase 2 — s2.4 (Operator observability & hygiene)
Mechanical, no decisions needed:
1. Skip filters on `SkipsPanel`.
2. Link skips back to originating turn (mint a `turn_id` in `TurnTracker`).
3. CSV export for skips and `roadmap_work_log`.
4. Linter sweep — `REVOKE EXECUTE … FROM anon, public` on `has_role` and friends.

## How to test voice tomorrow
1. Open Telegram, find your bot.
2. Hold the mic button, speak: *"send a test message to chat 123 saying hi"*.
3. Webhook receives `voice`, transcribes, classifies (likely `send_message` risk=medium → needs approval), and you'll get an inline approve/reject button on Telegram. Hit Approve → action runs; the decision flows through `awip-api` so `callback_url` callbacks would fire if any module is registered.

If a voice note silently fails: check `supabase--edge_function_logs telegram-webhook` (search "transcribe failed" or "getFile failed").

## Memory updated
`mem://features/automation` now documents the operator channel + voice transcription contract.
