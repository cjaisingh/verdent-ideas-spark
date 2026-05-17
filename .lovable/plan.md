## Wire `gemma4` as the default Ollama model

Screenshot confirms the local Ollama box answers as "Gemma 4" via the `gemma4` tag (visible in the model picker bottom-right). Update the worker + contract defaults so jobs route to it without per-job overrides.

### Changes

1. **`docs/ai-jobs-ollama.md`**
   - `MODEL_TAGS` example → `gemma4`
   - `DEFAULT_MODEL` default row → `gemma4`
   - "At least one model pulled" line → `ollama pull gemma4`
   - Expected first-lines log block → `tags=gemma4`, `default_model=gemma4`

2. **`supabase/functions/_shared/contracts/ai-jobs.ts`**
   - `AI_JOBS_CONTRACT.defaultModel`: `"llama3.1:8b"` → `"gemma4"`

3. **Worker artefact** (`/mnt/documents/ollama-worker/worker.mjs` + `.env.example`)
   - `.env.example`: `MODEL_TAGS=gemma4`, `DEFAULT_MODEL=gemma4`
   - `worker.mjs`: fallback constants for `DEFAULT_MODEL` and `MODEL_TAGS` → `gemma4`
   - README example commands → `gemma4`

4. **Producer dialog** (`src/components/admin/EnqueueDraftDialog.tsx`)
   - If it shows a "requested model" hint/placeholder, update placeholder to `gemma4` (leave field optional — empty still means "use worker default").

### Out of scope

- No DB migration: `ai_jobs.required_model_tags` stays nullable; existing queued rows untouched.
- No change to `pickModel()` / night policy — that governs Lovable AI Gateway models, not Ollama tags.
- No new model-capability gating; single-tag worker is fine for Slice 1.

### Verification

- `rg -n "llama3\.1:8b" docs/ supabase/ src/ /mnt/documents/ollama-worker/` returns nothing after edits.
- Re-read `docs/ai-jobs-ollama.md` to confirm setup steps are internally consistent.
- Worker, on next launch with refreshed `.env`, logs `tags=gemma4 default_model=gemma4`.
