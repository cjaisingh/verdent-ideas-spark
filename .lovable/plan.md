## Goal

Add a self-learning loop to Copilot voice. When you say "learn from this", "remember that", "next time…", or "from now on…", Copilot extracts a concise rule and stores it in a new `copilot_lessons` table. Active lessons are injected into the system prompt on every turn, so behaviour persists across sessions. Also add a UI-flippable model toggle (gpt-5-mini ↔ gemini-2.5-pro) to A/B intelligence vs cost.

## Why this addresses the transcript

In recent sessions Copilot has felt "less intelligent" not because of raw model capability but because:
- Each session starts with zero memory of prior corrections.
- Trigger phrases like "learn from this" have no handler — the model just acknowledges politely and forgets.
- There's no way to switch brains when one feels weak on a given topic.

Lessons + a model toggle fix all three without touching Deepgram config.

## Database

New migration:

- `copilot_lessons` table:
  - `id uuid pk`, `lesson text not null` (≤500 chars, validation trigger), `scope text not null default 'global'` (`global` | `notebook` | `approvals` | `voice_style`), `source text not null default 'voice'` (`voice` | `manual`), `active boolean not null default true`, `created_by text`, `created_at`, `updated_at`.
  - Operator/admin RLS for select/insert/update/delete.
  - Added to `supabase_realtime` publication.
  - `updated_at` trigger.
- Extend `copilot_settings` with `model text not null default 'openai/gpt-5-mini'` (allowed: `openai/gpt-5-mini`, `google/gemini-2.5-pro`, `openai/gpt-5`, `google/gemini-2.5-flash`).

## Edge function changes

`supabase/functions/awip-api/index.ts`:
- `GET /lessons?active=true` — list.
- `POST /lessons` — create (body: `{ lesson, scope?, source? }`), idempotent.
- `PATCH /lessons/:id` — toggle active / edit text / change scope.
- `DELETE /lessons/:id` — remove.

`supabase/functions/copilot-voice/index.ts`:
- On `auth`, fetch operator's `copilot_settings.model` (default `openai/gpt-5-mini`) and load active lessons. Cache both in the `Session` object.
- Subscribe to realtime `copilot_lessons` inserts/updates/deletes for this session and refresh the cache.
- Build system prompt per `think()` as `SYSTEM_PROMPT + "\n\nLESSONS LEARNED (always honour):\n- …"`.
- Pass `session.model` to the AI Gateway request instead of hard-coded `openai/gpt-5-mini`.
- Add tools:
  - `remember_lesson({ lesson, scope? })` — POSTs to `/lessons`.
  - `list_lessons()` — GETs `/lessons?active=true`.
  - `forget_lesson({ id })` — DELETE.
- Extend system prompt with: "When the operator says 'learn from this', 'remember that', 'next time…', or 'from now on…', call `remember_lesson` with a one-sentence rule, then briefly confirm ('Got it, I'll remember that.'). Never store secrets, names of individuals, or PII."

## UI changes

- New page `src/pages/Lessons.tsx` (list, toggle active, edit, delete; filter by scope; same design language as `Notebook.tsx`).
- Route `/lessons` added in `App.tsx`, inside `RequireAuth` + `OperatorLayout`.
- Sidebar entry in `AppSidebar.tsx` ("Lessons", under Copilot section).
- Small card on `/copilot` showing active lesson count + link.
- Model selector on `/copilot` (or in `CopilotProfile.tsx`) — dropdown bound to `copilot_settings.model`. Live-applies on next turn.

## Out of scope

- Auto-extracting lessons without an explicit trigger (would create noisy memory).
- Per-agent lesson scoping (single global pool for now; `scope` field reserved for future).
- Vector retrieval — short list injected into prompt is sufficient until we exceed ~30 lessons.
