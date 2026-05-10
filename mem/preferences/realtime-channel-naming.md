---
name: Realtime channel naming
description: Always use unique per-mount channel names for supabase.channel() to avoid StrictMode/HMR "cannot add postgres_changes callbacks after subscribe()" crashes
type: preference
---

**Rule:** every `supabase.channel("...")` call inside a `useEffect` MUST use a unique name per mount.

**Why:** supabase-js caches channels by name. Under React StrictMode dev (double-mount) and HMR, the cleanup's `removeChannel` can race with a remount that reuses a still-`joined` cached channel. Calling `.on()` on a subscribed channel throws:

> `cannot add postgres_changes callbacks for realtime:<name> after subscribe()`

The `/roadmap` page crashed on this 2026-05-10 via `WorkLogPulse`.

**How to apply:**

```ts
// ✅ correct
const channel = supabase
  .channel(`work_log_pulse:${crypto.randomUUID()}`)
  .on("postgres_changes", { ... }, handler)
  .subscribe();
return () => { supabase.removeChannel(channel); };

// ❌ wrong — static name + StrictMode = crash on remount
supabase.channel("work_log_pulse").on(...).subscribe();
```

Sentinel watches for regressions via `checkFrontendRealtimeErrors` (15-min window over `frontend_error_logs`).
