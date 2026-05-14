# Hermes slice 3 — Companion session auto-resume

Today, `/companion` streams assistant replies into transient state (`setStreaming(acc)`) and only writes the final assistant row when the stream finishes. If the operator refreshes, switches device, or the connection drops mid-stream, the partial answer is lost and the user message is left stranded. There's also no per-operator memory of which thread was last active — on load we just pick "newest by `updated_at`".

Slice 3 fixes both: persist assistant streams as they happen, detect interrupted ones, offer a one-click resume, and remember the last-active thread per operator across devices.

## Schema (1 migration)

**Extend `companion_messages`:**

| column | type | note |
|---|---|---|
| `status` | text default `'complete'` check in (`pending`,`streaming`,`complete`,`interrupted`,`error`) | new |
| `streamed_at` | timestamptz null | new — heartbeat timestamp during stream |

Backfill: existing rows → `status='complete'`. Index `(thread_id, status)` for the resume scan.

**New table `companion_session_state`** (operator-only RLS, realtime on):

| column | type |
|---|---|
| `user_id` uuid pk references auth.users | |
| `last_thread_id` uuid null references companion_threads on delete set null | |
| `last_seen_at` timestamptz default now() | |
| `updated_at` timestamptz default now() | |

RLS: `created_by = auth.uid() AND has_role(auth.uid(), 'operator')` for select/insert/update; no delete policy. Trigger on update to bump `updated_at`.

## Client changes — `src/pages/Companion.tsx`

**Streaming persistence (replaces current "insert on completion" logic in `sendMessage`):**

1. After the user message INSERT, immediately INSERT the assistant row with `content=''`, `status='streaming'`, `model`, `streamed_at=now()` and keep the returned `id` (`asstId`).
2. While reading the SSE stream, throttle (1s window) UPDATEs to `companion_messages` setting `content=acc` and `streamed_at=now()`.
3. On stream end → UPDATE `status='complete'`, `content=acc`, `latency_ms`, `rag_chunk_ids`. Bump `companion_threads.updated_at` (existing).
4. On thrown error → UPDATE `status='error'`, `content=acc` (whatever streamed so far). Surface toast as today.

**Resume detection (new effect, runs on `activeId` change after messages load):**

- Find the latest message in the thread. If `role='assistant'` AND (`status='streaming'` AND `streamed_at < now()-30s`) OR `status='interrupted'` → mark it `interrupted` (idempotent UPDATE) and render a `<ResumeBanner />` above the composer.
- Banner: "Last reply was interrupted (showed N chars). [Resume] [Discard]".
  - **Resume** → reuse the prior user message as the prompt, delete the interrupted assistant row, re-enter `sendMessage` flow with that text pre-loaded (skipping a duplicate user-row insert by passing an internal `_resumeFromUserMsgId` arg).
  - **Discard** → leave the row as `interrupted`; banner dismisses.

**Session state (last-active thread):**

- New helper `useCompanionSessionState()` that on mount upserts `companion_session_state` and reads `last_thread_id`.
- The current `loadThreads()` initial-pick logic changes: if no `?thread=` deep-link and no current `activeId`, prefer `last_thread_id` (when it exists in the loaded set), else fall back to "newest by updated_at" (today's behavior).
- Whenever `activeId` changes (user clicks a thread), debounce-upsert `last_thread_id` + `last_seen_at`.

**Cleanup on unmount:** if a stream is in-flight and the user closes the tab, the `streaming` row simply ages out — the resume scan on next mount will catch it. Do NOT try to mark it interrupted on `beforeunload` (best-effort and racy).

## Sentinel check

New finding `companion_streams_stalled` (medium) in `sentinel-tick/checks.ts`:

- Fires when `companion_messages.status='streaming' AND streamed_at < now()-5min` count > 5 in the last 24h.
- Same shape as the existing `lint_delta_failures` check from slice 2. Not auto-promoted.

## Out of scope

- Server-side stream persistence inside `companion-cloud-chat` (client-side heartbeat is enough for v1; server-side adds complexity without solving the disconnect case any better).
- Scroll-position restoration (just lands at bottom as today).
- Cross-thread "what were we doing?" summary on resume — single-message granularity only.
- Voice mode auto-resume (the voice dock has its own state machine; slice it separately).
- Rork iPhone integration — that app already reads `companion_messages`, so streamed rows just appear there once shipped; no new endpoint needed.
- Slice 5 onward.

## Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_companion_session_resume.sql` | new — `companion_messages` columns + `companion_session_state` table + RLS + index + trigger |
| `src/pages/Companion.tsx` | edit — streaming persistence, resume scan, session-state restore + persist |
| `src/components/companion/ResumeBanner.tsx` | new — small banner with Resume / Discard |
| `supabase/functions/sentinel-tick/checks.ts` | edit — `companion_streams_stalled` |
| `supabase/functions/sentinel-tick/index.ts` | edit — wire new check |
| `mem/features/companion-resume.md` | new — feature memory |
| `mem/index.md` | edit — append link |
| `CHANGELOG.md` | edit — Hermes slice 3 entry |
| `docs/rork-companion-spec.md` | edit — note new `status` field on `companion_messages` |

## Verification

1. `supabase--migration` applies cleanly; `bun run rls:verify` (if present) green.
2. Manual: open `/companion`, send a message, refresh mid-stream → on reload the partial assistant message is visible with the resume banner; click Resume → completes correctly.
3. Switch threads, refresh page (no `?thread=` param) → lands on the previously-active thread, not "newest by updated_at".
4. Insert 6 fake stalled streaming rows via SQL, force `sentinel-tick` → `companion_streams_stalled` finding appears in `/admin/sentinel`.
5. RLS: confirm a second operator can't read another operator's `companion_session_state` row.
