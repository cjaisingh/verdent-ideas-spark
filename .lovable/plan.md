The Settings test still shows **Failed · Failed to fetch** even though `curl http://localhost:11434/api/tags` returns 200 from your Mac. That means the browser request is being blocked before Ollama ever sees it. Two likely causes — we need to figure out which one before changing code.

## Likely causes

1. **CORS preflight rejected by Ollama.** `launchctl setenv` only affects apps launched *after* the setenv from a shell-launched process. The Ollama menu-bar app started by macOS at login does not inherit it. Quitting/reopening from the menu bar is often not enough — it has to be relaunched from a shell that has the var, or set via `launchctl` + a full logout, or via the Ollama app's own `OLLAMA_ORIGINS` setting.
2. **Mixed-content block.** The preview is `https://*.lovableproject.com` calling `http://localhost:11434`. Chrome treats `localhost` as a secure context and allows it; Safari and Firefox often do not, and even Chrome blocks it inside some iframes. The Lovable preview renders inside an iframe, which is exactly where this fails.

## Diagnostic steps (you run, no code changes yet)

1. In the Mac terminal:
   ```
   launchctl getenv OLLAMA_ORIGINS
   ```
   - If this prints empty → the setenv didn't stick. Re-run the setenv, then **fully quit Ollama** (menu bar → Quit, then `pkill -f Ollama` to be sure) and relaunch.
   - If it prints the origins → CORS env is set; cause is likely #2 (mixed content).

2. From the Mac terminal, simulate the browser preflight:
   ```
   curl -i -X OPTIONS http://localhost:11434/api/tags \
     -H "Origin: https://c58aeaea-93be-4b64-bb57-aeef50ab6dcd.lovableproject.com" \
     -H "Access-Control-Request-Method: GET"
   ```
   Look for `Access-Control-Allow-Origin` in the response.
   - Missing → Ollama doesn't know about the origin (cause #1).
   - Present → cause is #2 (browser mixed-content / iframe block).

3. Tell me which browser you're using (Chrome / Safari / Arc / Firefox) and paste the output of step 2.

## Fix paths (chosen after diagnosis)

- **If cause #1 (CORS):** Switch from `launchctl setenv` to launching Ollama from a shell that exports `OLLAMA_ORIGINS`, or set it in `~/Library/LaunchAgents/com.ollama.plist`. No app code change needed.
- **If cause #2 (mixed content):** Code change in `src/pages/Companion.tsx` — when the page is served over `https:` and the configured base URL is `http://localhost:*`, detect the fetch failure and surface a clearer error plus a one-click "Open Companion in a new tab" using the Lovable Cloud HTTPS tunnel, or instruct the user to open the preview in its own tab (outside the iframe) where Chrome permits localhost. Optionally add a small helper that auto-tries `127.0.0.1` as a fallback.

## Why not just change code now

The current "Failed to fetch" is generic — it covers both CORS rejection and mixed-content block, and they need opposite fixes (env vs UX). Running the two curl checks above takes ~30 seconds and tells us which one to ship.

Reply with the output of the two commands and your browser, and I'll execute the matching fix.
