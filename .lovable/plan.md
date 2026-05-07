# Fix: session voice settings now apply (and apply live)

Two bugs stack together today:

1. The active Copilot agent silently overrides the session voice — `tts_voice: activeAgent?.tts_voice ?? ttsVoice` in `Copilot.tsx` means an agent always wins, so the dropdown in the Settings sheet looks saved but does nothing.
2. Even when the right field changes, the voice is only sent to Deepgram once at socket open. Mid-session changes require restarting the session.

## Changes

### 1. `src/pages/Copilot.tsx` — flip precedence
In the WebSocket auth payload (~line 284), treat the operator's session settings as the master preference, with the agent as fallback:
```ts
tts_voice: ttsVoice || activeAgent?.tts_voice,
language: language || activeAgent?.language,
greeting: greeting || activeAgent?.default_greeting,
```
Per-agent voice overrides on `AgentScopeCard` still work — they live on `copilot_agent_overrides` and are merged into `activeAgent.tts_voice` via `effective()`. The session-level pick simply wins when set.

### 2. `src/pages/Copilot.tsx` — live-apply on change
Add a small effect that, when `ttsVoice` changes while a session is active, sends a control frame over the existing WebSocket:
```ts
useEffect(() => {
  if (!active || !wsRef.current) return;
  if (wsRef.current.readyState !== WebSocket.OPEN) return;
  wsRef.current.send(JSON.stringify({ type: "update_voice", voice: ttsVoice }));
}, [ttsVoice, active]);
```
Update `ttsVoiceRef.current` in the same effect so the rest of the app stays in sync.

Also drop the "restart session to apply" hint from `saveVoiceSettings` toast — it's no longer needed for voice.

### 3. `supabase/functions/copilot-voice/index.ts` — proxy to Deepgram
In the client `onmessage` handler, before the `auth` branch handling, add a case:
```ts
if (msg.type === "update_voice" && typeof msg.voice === "string") {
  settings.tts_voice = msg.voice;
  if (dg && dg.readyState === WebSocket.OPEN) {
    dg.send(JSON.stringify({
      type: "UpdateSpeak",
      speak: { provider: { type: "deepgram", model: msg.voice } },
    }));
  }
  return;
}
```
This uses Deepgram Voice Agent's `UpdateSpeak` control message, which swaps the TTS model on a live converse session without dropping audio. The cached `settings.tts_voice` ensures any subsequent reconnect keeps the new voice.

### 4. Deploy
Redeploy `copilot-voice` so the new control message is recognized.

## Out of scope
- Live-applying language and greeting mid-session (those need a session restart on Deepgram's side; we'll keep the existing toast hint for those two fields only).
- UI copy changes beyond the toast — the dropdown labels are already clear.

## Acceptance
- Open `/copilot` → Settings sheet → change "TTS voice" → click Save. The next thing the agent says uses the new voice, no restart required.
- With no session active, save persists in `copilot_settings.tts_voice` and is applied on the next session start.
- The per-agent voice override on `AgentScopeCard` still works when the session voice is left at its default.
