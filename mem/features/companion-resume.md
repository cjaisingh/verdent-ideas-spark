---
name: Companion session auto-resume
description: companion_messages.status + streamed_at, companion_session_state, ResumeBanner, companion_streams_stalled sentinel
type: feature
---

# Companion auto-resume (Hermes slice 3)

## Why

`/companion` used to keep streaming assistant text in `setStreaming(acc)` only and write the final row at the end. Refresh / disconnect mid-stream lost the partial reply and stranded the user message. There was also no per-operator memory of which thread was active — load picked "newest by `updated_at`".

## Schema

- `companion_messages.status text` default `'complete'`, check in (`pending`,`streaming`,`complete`,`interrupted`,`error`).
- `companion_messages.streamed_at timestamptz` — heartbeat written ~1s during stream.
- Index `(thread_id, status)` for the resume scan.
- New `public.companion_session_state` (PK `user_id`, `last_thread_id`, `last_seen_at`, `updated_at`). Operator-only RLS; realtime on; `update_updated_at_column` trigger.

## Stream lifecycle (client, `src/pages/Companion.tsx`)

1. Insert user row (`status='complete'`).
2. Insert assistant row up-front with `content=''`, `status='streaming'`, `streamed_at=now()`.
3. While reading the SSE stream, throttle UPDATEs (~1s) of `content` + `streamed_at`.
4. On clean end → UPDATE `status='complete'`, finalised `content`, `latency_ms`.
5. On thrown error → UPDATE `status='error'` (preserve partial content).

## Resume detection

On message load, the most recent assistant row is checked. If `status='interrupted'` or `'error'`, OR `status='streaming'` with `streamed_at` >30s old → idempotently mark it `interrupted` and render `ResumeBanner` above the composer. Resume deletes the interrupted row, reuses the prior user message, and re-runs `sendMessage({ skipUserInsert: true })`. Discard leaves the row as `interrupted`.

## Last-active thread

- On any `activeId` change, debounce-upsert `companion_session_state.last_thread_id`.
- On first load (no `?thread=`), `loadThreads()` reads `last_thread_id` and lands on it if present in the loaded set; otherwise newest by `updated_at`.

## Sentinel

`companion_streams_stalled` (medium): >5 `companion_messages` rows with `status='streaming'` AND `streamed_at < now()-5min` in the last 24h. Wired in `sentinel-tick/index.ts` next to `lint_delta_failures`. Day-bucketed dedupe key.

## Realtime

The `companion-${activeId}-…` channel listens to BOTH `INSERT` and `UPDATE` on `companion_messages` so heartbeats and finalisations propagate live to other tabs/devices. Channel name keeps the per-mount random suffix to satisfy the realtime channel naming rule.

## Anti-patterns

- Don't try to mark `interrupted` on `beforeunload` — racy and best-effort. Let the resume scan catch it on next mount.
- Don't move stream persistence server-side just for "robustness"; the upstream Lovable AI gateway tee already cancels when the client disconnects, so server-side rows would have the same dangling-`streaming` problem. Heartbeat from the client is the right primitive.
- Don't auto-rerun on resume detection — always let the operator confirm via the banner.
- Never write `last_thread_id` for a non-operator user; the upsert is gated by RLS.
