# Plan — next few days

_Updated tonight while you sleep. Live state on `/roadmap`. Operator notes on `/notebook`._

## What I shipped tonight
- **Notebook tab** (`/notebook`) — kinds (thought / issue / research / suggestion / todo), tags, pin, status, search, realtime. Backed by `notebook_entries` (operator-only RLS).
- **Sidebar nav** — collapsible icon-strip sidebar replaces the cramped top nav. Main content max-width 1600px so `/roadmap`, `/api-logs`, `/memory` actually use the screen. Sign-out + pending approvals stay in the top header.
- Seeded notebook with 6 starter entries: 2 pinned **decisions I need from you**, plus the outstanding s2.4 hygiene items.
- Logged a new sprint `s2.5 — Operator UX` (done) so the work is tracked.

## Decisions I need from you (pinned in notebook)
1. **Telegram module shape (phase-3)** — same Supabase project with a namespace, or a separate operator_channel project?
2. **Voice transcription model (phase-4)** — Gemini 2.5 Flash via Lovable AI (free in plan, recommended) or Whisper via OpenAI (extra key)?

Once you answer those two I can land phases 3 and 4 end-to-end without guessing.

## What I'm NOT doing tonight (and why)
- **Phase 3 cutover** — touches webhook URL routing and drops live tables. Doing this without confirming the module shape risks breaking your Telegram bridge. Blocked on Q1.
- **Phase 4 voice** — needs Q2 answered + a sample voice clip from you to test against.
- **s2.4 t4 (linter fixes)** — straightforward `REVOKE EXECUTE ... FROM anon, public` migration on `has_role` and friends. I left it as a tracked todo because it touches every SECURITY DEFINER function and I'd rather you eyeball the list before we lock anon out (10 functions).

## Suggested order for tomorrow (no decisions needed)
Pick these off in any order — all mechanical:

1. **s2.4 t1** — Skip filters (source / reason / date) on `SkipsPanel`.
2. **s2.4 t3** — CSV export for `roadmap_autolog_skips` and `roadmap_work_log`.
3. **s2.4 t2** — Mint a `turn_id` per TurnTracker session and stamp it on both `roadmap_work_log` and `roadmap_autolog_skips`, then link "Open turn" from each skip row.
4. **s2.4 t4** — Linter sweep (after you say go).
5. **Roadmap split-pane** — sprint list left, task detail right; uses the new screen real estate. Bonus, not on roadmap yet.

## Then, with your answers
- **s2.2 (Telegram move)** → 1 session.
- **s2.3 (Approval callback wiring + Telegram update_id idempotency)** → 1 session.
- **Phase 3 cutover** → 1 session (smoke test + drop old tables).
- **Phase 4 voice** → 1 session (detect → transcribe → re-route as text).

Realistic: phases 2-4 fully closed in ~4 working sessions after your morning answers. Tonight I prioritised giving you a clean place to land thoughts and a usable layout over half-shipping a cutover that would brick the bot.

## Outstanding from the previous plan (still relevant)
- Auto-default TurnTracker task to active sprint (B in old plan) — small.
- "Unlogged turns this week" counter on `/roadmap` — small.
- AI weekly code review cron is already deployed (`scheduled-code-review`); confirm GitHub token is in secrets and we can flip it on.

Sleep well — drop anything in `/notebook` when you wake up and I'll work from there.
