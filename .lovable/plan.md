## What's happening

`/roadmap` is crashing into the ErrorBoundary with:

> `cannot add postgres_changes callbacks for realtime:work_log_pulse after subscribe()`

Yes, I see it — it's in the runtime-errors snapshot for this turn. It's a real, reproducible error, not a one-off.

### Root cause

`src/components/WorkLogPulse.tsx` (and two siblings) open a Supabase realtime channel using a **static channel name** inside a `useEffect`:

```ts
const channel = supabase.channel("work_log_pulse").on(...).subscribe();
```

Under React StrictMode (dev) and HMR, the effect mounts → unmounts → remounts. The cleanup calls `removeChannel`, but supabase-js caches channels by name; the second mount can reuse a channel that's **already in `joined` state**, and calling `.on()` on a subscribed channel throws exactly this error.

Same antipattern (static channel name) lives in:
- `src/components/PendingApprovalsIndicator.tsx` → `"approval_queue_indicator"`
- `src/components/SentinelStatusStrip.tsx` → `"sentinel-strip"`

These haven't crashed yet but are one StrictMode remount away from the same error.

### `frontend-errors` is supposed to catch this

`src/lib/frontend-error-capture.ts` + the `frontend-errors` edge function already exist to ship runtime errors to the backend — but I haven't verified they actually fired for this one. We should confirm the pipeline caught it (or fix it if it didn't).

---

## Plan

### 1. Fix the crash (3 files)

For each component, switch to a per-mount unique channel name and a guard so HMR can't double-subscribe.

```ts
const channel = supabase
  .channel(`work_log_pulse:${crypto.randomUUID()}`)
  .on("postgres_changes", { ... }, () => load())
  .subscribe();
return () => { supabase.removeChannel(channel); };
```

Apply to:
- `src/components/WorkLogPulse.tsx`
- `src/components/PendingApprovalsIndicator.tsx`
- `src/components/SentinelStatusStrip.tsx`

### 2. Verify the error pipeline caught it

- Query `frontend_errors` (or whatever table `frontend-errors` writes to) for a row matching this message in the last hour.
- If absent → there's a gap in capture; fix the listener so ErrorBoundary errors are forwarded.
- If present → confirm it surfaces in `/admin/logs` (or wherever) so future occurrences are visible without me reading the runtime snapshot.

### 3. Add a sentinel check

Add a check to `supabase/functions/sentinel-tick/checks.ts` that flags when `frontend_errors` shows >0 rows in the last 15 min matching realtime channel patterns (`cannot add .* callbacks`, `CHANNEL_ERROR`, `tried to subscribe multiple times`). This rolls into the morning review automatically (per `mem://features/sentinel`).

### 4. Lint guard (optional, low effort)

Add a one-line ESLint rule or `scripts/check-realtime-channels.ts` that greps for `supabase.channel("` with a static string literal and warns. Keeps this antipattern out of new code.

### 5. Doc + memory

- Add a short note to `docs/development.md` under "Realtime channels": always use unique names + `removeChannel` in cleanup.
- Save a `mem://preferences/realtime-channel-naming` rule so I apply it automatically next time.

---

## Out of scope

- The underlying realtime client cache behavior (that's supabase-js internal).
- Rewriting the three components — only the channel-creation block changes.
- The external_reviews ingest workstream (already logged as todo `324e175a`).

---

## Files touched

- `src/components/WorkLogPulse.tsx` — unique channel name
- `src/components/PendingApprovalsIndicator.tsx` — unique channel name
- `src/components/SentinelStatusStrip.tsx` — unique channel name
- `supabase/functions/sentinel-tick/checks.ts` — new realtime-error check
- `docs/development.md` — realtime channel guidance
- `mem://preferences/realtime-channel-naming` — new memory + index update
- (optional) `scripts/check-realtime-channels.ts` — static-name lint script

No DB migration. No new tables. No edge function deploys beyond `sentinel-tick`.
