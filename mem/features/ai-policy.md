---
name: AI model policy
description: Cost/risk model-selection rules — night-window cheap-model coercion, TTS bypass, contract-first for new agent loops
type: feature
---

Single chokepoint: `supabase/functions/_shared/model-policy.ts → pickModel()`. Every edge function that hits an LLM goes through it.

## Rules

1. **Night window (22:00–06:00 UTC)** forces every job to `google/gemini-2.5-flash-lite` regardless of requested model. Saves credits + caps risk on unattended loops.
2. **TTS bypass.** `gemini-tts` and any audio-out call passes `{ bypassNightPolicy: true }` and keeps the requested voice model. Voice latency matters; cost is bounded.
3. **Operator-attended jobs** (Companion chat, Copilot) can request `openai/gpt-5` or `google/gemini-2.5-pro` during day window. Night still coerces.
4. **New agent loop** must declare a typed input contract in `_shared/contracts/<name>.ts` AND call `pickModel()` — never hard-code the model id. See `mem://preferences/contract-first`.
5. **Budget alerts** (`mem://features/budget-alerts`) fire at 80%/100% projected month-end burn. If alerts are firing, treat it as a hard signal to demote non-critical jobs to flash-lite even outside the night window.

## Verify

- `rg "anthropic|gpt-4|claude-3" supabase/functions/` → should return 0 hits (legacy callers).
- `select model, count(*) from ai_usage_log where created_at > now() - interval '1 day' and created_at::time between '22:00' and '06:00' group by 1;` → should be dominated by `gemini-2.5-flash-lite`.

See `mem://features/night-cheap-models`, `mem://features/credits-usage`, `mem://features/tool-policy`.
