## Goal
In Companion → Settings, replace the free-text "Local model" input with a dropdown populated from Ollama's `/api/tags`, so you can pick any installed model directly.

## Changes (single file: `src/pages/Companion.tsx`)

1. **New hook `useOllamaModels(baseUrl)`** — fetches `${baseUrl}/api/tags` on mount and whenever `baseUrl` changes (debounced ~300ms), with 4s timeout. Returns `{ models: string[], loading, error, refetch }`. No-op when cloud mode is on.

2. **Replace the Local model `<Input>` (line 588–589)** with:
   - A `<Select>` listing detected models when fetch succeeds and at least one model exists.
   - The currently configured `ollama_model` is preselected. If it isn't in the list, show it as a disabled "(not installed)" item at the top so the user sees the mismatch.
   - A small refresh icon button next to the select to re-run the fetch.
   - **Fallback:** if the fetch errors or returns zero models, render the existing `<Input>` plus an inline hint ("Couldn't reach Ollama — type a model name"). This keeps the field usable when Ollama is offline.

3. **Reuse, don't duplicate:** `TestOllamaButton` already fetches `/api/tags` on click. Extract a tiny shared `fetchOllamaModels(baseUrl)` helper at module top so both the new hook and the test button use the same code path.

4. **No behaviour change** to: cloud model select, RAG toggle, chat send path, message storage, or the "closest model" suggestion flow — the suggestion picker keeps working when the user manually types a non-installed name (e.g. via the fallback input).

## Out of scope
- No changes to Ollama CORS handling, edge functions, or DB schema.
- No new memory file (existing `mem://features/companion.md` already covers settings).

## Verification
- Open Settings: dropdown lists installed models from `curl localhost:11434/api/tags`.
- Pick one → reflected in `settings.ollama_model`, persisted to localStorage `awip.companion.settings.v1`, and shown in the footer "model …" label.
- Stop Ollama → reopen Settings: dropdown falls back to text input with hint.
- Change base URL → list refetches.
