# Give the Companion full read access to the environment + a learning loop

## Goal

Make `/companion` a true operator co-pilot: it reads from the whole environment, not just docs, and it captures lessons it learns so they persist across sessions. Browser-only surface, read-only writes are scoped to the lessons store. No new permissions model — RLS already restricts everything to operators.

## What's missing today

`Companion.tsx` only feeds the model two things:
- A small "morning review" seed (counts only).
- `awip-rag` doc search.

It never reads `discussion_actions` (jobs), `roadmap_tasks`, `sentinel_findings`, `audit_runs`, `ai_usage_log`, `automation_runs`, `capability_events`, `okr_node_events`, `morning_reviews`, `daily_plans`, `lessons`, `copilot_lessons`, etc. So it can't answer "what's on the jobs board?", "what failed last night?", "what did we ship this week?", or "what have I taught you before?".

## Two-layer access (read-only)

### Layer 1 — Per-turn environment snapshot (auto-injected)

New edge function `awip-companion-context` (operator JWT, `verify_jwt = false` + in-code `has_role` check) returns a compact JSON snapshot the chat injects as a system message before each turn. Sources:

- **Jobs board** — `discussion_actions` open + in-progress, top 25 by priority, with handles.
- **Roadmap** — `roadmap_tasks` in active phases, status counts + top 10 at-risk.
- **Last night** — most recent `automation_runs`, `sentinel_findings` (last 24h, severity≥med), `audit_runs` summary.
- **Today** — newest `daily_plans` row + newest `morning_reviews` row.
- **Health** — last 24h `ai_usage_log` totals (calls, tokens, cost, model mix), failed cron jobs from `list_all_nightly_jobs()`.
- **OKRs / capabilities** — last 10 `okr_node_events` + last 10 `capability_events`.
- **Active lessons** — all `copilot_lessons` for the current user + global `lessons` (capped, ordered by recency).

The function returns markdown ready to drop in as system context, capped at ~6 KB so it doesn't blow the prompt budget. Each section has a one-line header so the model can cite it (e.g. `[Jobs] J-123 …`).

### Layer 2 — On-demand RAG (already exists, broaden corpus)

Keep the existing `awip-rag/search` for docs. Add a second search path `awip-rag/search-data` that accepts a free-text query and routes to whichever table matches keywords (`jobs:`, `audit:`, `sentinel:`, `roadmap:`, `lesson:`) — pure pass-through, no new index. The Companion calls this only when the user's message contains a search-shaped question. Cheap, optional.

## Learning loop

The model already proposes "discussion actions" today. Extend that to a parallel "lesson capture" path:

- Reuse `public.copilot_lessons` (table already exists, validated by `validate_copilot_lesson` trigger — scopes: `global`, `notebook`, `approvals`, `voice_style`; ≤500 chars; sources: `voice`, `manual`).
- After every assistant turn, the Companion runs a small extraction prompt against the user+assistant pair: "Is there a durable preference, fact, or correction here? If yes, propose 0–3 lessons." Proposals appear in a new "Pending lessons" tray under the chat with **Save / Edit / Discard** controls; saved rows go to `copilot_lessons` with `source='voice'`.
- The per-turn snapshot (Layer 1) always includes the active lessons, so future turns reflect what's been learned.

## Settings (Companion settings sheet)

Three new toggles, persisted in the existing `SETTINGS_KEY` localStorage blob:
- **Environment context** (default on) — Layer 1.
- **Data search** (default on) — Layer 2.
- **Auto-extract lessons** (default on) — proposes; never auto-saves without click.

Footer status line gains `· env {on|off} · lessons {N}`.

## Files

- **New** `supabase/functions/awip-companion-context/index.ts` — Layer 1 aggregator.
- **New** `supabase/functions/awip-rag/search-data` route inside the existing `awip-rag` function (no new function).
- **Edited** `src/pages/Companion.tsx` — call context fn per send, render Pending lessons tray, settings switches, system-prompt addendum.
- **New** `src/components/companion/PendingLessonsTray.tsx` — small list with Save/Edit/Discard.
- **CHANGELOG.md** — one line.
- **`mem://features/companion.md`** — append: "Per-turn env snapshot + auto lesson capture into `copilot_lessons`."

## Out of scope (call out, do not build)

- **Write/CRUD tools** for the Companion (creating jobs, closing tasks, etc.) — separate PR after we trust the read path.
- **Rork iPhone** — same edge function will be reusable, but no Rork changes here.
- **New tables** — uses existing `copilot_lessons`, `lessons`, `discussion_actions`, etc.
- **Embeddings on data tables** — Layer 2 is keyword routing, not vector search.

## Verification

1. Open `/companion`, ask "what's on the jobs board?" → response cites real handles from `discussion_actions`.
2. Ask "what failed last night?" → cites real rows from `sentinel_findings` / `automation_runs`.
3. Tell it "always refer to me as 'Chief'" → a pending lesson appears; click Save; refresh; next turn it uses 'Chief'.
4. Toggle "Environment context" off → snapshot disappears from the next request payload (visible in Network tab).
5. Confirm context payload stays under ~6 KB on a busy day (log size in dev).
