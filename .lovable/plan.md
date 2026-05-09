## Goal
Make Companion’s local Ollama mode work reliably from the hosted preview, and make failures self-explanatory when the local machine setup is the blocker.

## Plan
1. **Harden local endpoint detection**
   - Update Companion’s Ollama checks to try safe local variants in order: `http://localhost:11434`, `http://127.0.0.1:11434`, and optionally `[::1]` formatting when needed.
   - Normalize the chosen working base URL before using it for model discovery, health status, test connection, and local chat.

2. **Improve diagnostics in the settings dialog**
   - Replace the current generic `Failed to fetch` messaging with actionable states, such as:
     - connection refused
     - CORS/origin blocked
     - browser cannot reach your local machine from this preview
     - no models installed
   - Show a specific hint when `localhost` fails but `127.0.0.1` is the likely fix, since your Ollama appears to be listening on IPv6 while the preview/browser path may be attempting IPv4.

3. **Keep local mode from silently degrading**
   - Ensure the same resolved local URL is used everywhere local Ollama is called:
     - model dropdown fetch (`/api/tags`)
     - health badge
     - “Test Ollama connection”
     - actual local chat streaming (`/v1/chat/completions`)
   - Prevent the UI from implying local mode is available if the browser cannot actually reach the selected base URL.

4. **Add an explicit fallback UX**
   - If no browser-reachable local endpoint is found, keep the manual model input but pair it with a clear explanation and a one-line recommendation to switch the base URL to `http://127.0.0.1:11434`.
   - Preserve cloud mode as the fallback rather than failing mid-chat.

## Technical details
- Main file: `src/pages/Companion.tsx`
- Refactor the shared Ollama fetch helper so it can classify network failures and probe alternative local loopback addresses.
- Reuse that helper for health check + send path so behavior stays consistent.
- No backend/schema changes are needed unless we later decide to add a backend relay/proxy for local development.

## Expected result
After implementation, Companion should either:
- successfully discover and use the local Ollama instance from the preview, or
- tell you exactly why it cannot and what to change next, instead of only showing `Failed to fetch`.