// Copilot voice page replaced 2026-05-28 (Lane 1 zombie kill).
// The `copilot-voice` edge function (WebSocket STT/TTS gateway) was deleted
// after operator confirmation — superseded by `gemini-tts` + Companion chat.
// This stub redirects to /companion so any bookmarks still resolve.
import { Navigate } from "react-router-dom";

export default function Copilot() {
  return <Navigate to="/companion" replace />;
}
