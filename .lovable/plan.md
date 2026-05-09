## Where we are in the scheme of things

W1→W6 spine is shipped (`plan_tasks` 41/41 done). Roadmap backlog: **2 in_progress, 124 todo, 19 done**. Open `discussion_actions` includes two directly relevant items: *"Define process for operator to monitor Lovable AI's current activity"* and *"Define process for operator to view workstation work streams"* — exactly what this plan addresses.

This plan is the **single source of truth** for the Companion-reachability work. It merges three threads into one shippable unit:

1. **Hook the Companion into all of AWIP** (live state injection, not just docs) — *infra shipped, wiring in progress*
2. **Fix iPhone install** of the Companion PWA — **shipped (pending publish)**
3. **Add two-way voice** to the Companion (parity with Copilot) — *stub mounted, Deepgram loop pending*

### Status legend
- ✅ shipped  ·  🟡 in progress  ·  ⬜ not started  ·  🔵 optional

---

## Part 1 — Hook the Companion into live AWIP state

### Problem
Today the Companion only knows: (a) the static doc corpus via `awip-rag/search`, and (b) — for the Morning Review seed only — the latest `daily_plans` + `morning_reviews` row. It has no idea about live roadmap, open actions, overnight runs, recent automation failures, sentinel/audit findings, or what Lovable is currently coding. So "what are you working on?" only paraphrases docs.

### 1a. ✅ New edge function `companion-context` (operator JWT) — *deployed*
Returns a compact deterministic JSON snapshot, recomputed per turn (cached 30s in-memory):

```text
{
  generated_at, window_hours: 24,
  lovable_focus: {
    active_tasks: [...roadmap_tasks status=in_progress],
    recent_changes: [...top 5 roadmap_task_activity],
    last_code_review: { ran_at, findings, severity_counts },
    overnight: { last_run, queued, running }
  },
  operator_queue: {
    open_actions: [...discussion_actions open, priority desc, top 8],
    deferred_due_today: [...],
    pending_approvals: count
  },
  health: {
    last_morning_review: { date, stuck_jobs, top_actions, open_findings },
    sentinel_open: { high, medium, low },
    deep_audit_latest: { ran_at, severity_counts },
    automation_24h: { runs, failures, last_failure },
    ai_cost_24h_usd, ai_cost_7d_usd
  },
  roadmap_summary: { in_progress, todo, blocked, done }
}
```

Read-only. No writes. ~2–4 KB JSON. One indexed query per section.

### 1b. 🟡 Wire into Companion as a third system message
In `src/pages/Companion.tsx → sendMessage()`, alongside RAG, fetch `/companion-context` and inject as a Markdown system block between `SYSTEM_PROMPT` and the RAG blob:

```text
## AWIP live state (auto-injected)
**Lovable is working on:** WIP-21 "Update TaskJanitor…", WIP-22 "Audit 13 closed tasks"
- Last code-review: 04:30 UTC, 3 high / 1 critical
- Overnight queue: 2 queued, 0 running
**Operator queue:** 4 open actions, 0 deferred due today
**Health:** Sentinel 0H/1M, Audit clean (Mon), 24h AI spend $0.42
**Roadmap:** 2 in-progress / 124 todo / 19 done
```

Update `SYSTEM_PROMPT` so the model treats this block as authoritative live state and prefers it over the doc corpus when answering "what are you working on / what's blocked / what's next". Header pill shows **"Live state ✓ · age 4s"**; 60s auto-refresh; manual refresh button.

**Status:** `src/lib/companion-live-state.ts` (fetcher + Markdown formatter + seed templates) shipped. Injection into `sendMessage`, header pill, and auto-refresh still pending.

### 1c. ⬜ Two new quick-seed thread buttons (alongside Morning Review)
- **"What is Lovable doing?"** — seeds with `lovable_focus` + last 10 `roadmap_task_activity` + last `scheduled-code-review` summary. Prompt: *"Walk me through what's actively being built and what I should sanity-check."*
- **"Operator queue review"** — seeds with `operator_queue` + open sentinel/audit findings. Prompt: *"Help me triage these — which are blocking, which can wait, which should be promoted?"*

Templates exist in `companion-live-state.ts`; UI buttons not yet mounted.

### 1d. 🔵 Optional RAG extension (same PR)
`scheduled-morning-review` writes three synthetic "live" docs nightly via `awip-rag/ingest` so older threads can still recall context: `live/roadmap-state.md`, `live/automation-health.md`, `live/lessons-recent.md`. Primary fix is per-turn injection above.

---

## Part 2 — Fix iPhone install

### Diagnosis (most likely → least)
1. **Project isn't published.** iOS Safari only offers a real "Add to Home Screen" install when browsing the **published origin in Safari directly** — never inside the Lovable editor preview iframe and never on `id-preview--…lovable.app`. Until you publish + open the live URL in mobile Safari, you get a generic Safari shortcut, not the PWA. **This is the gating step.**
2. **Wrong `apple-touch-icon` size.** `index.html` points at `companion-icon-512.png` (512×512). iOS expects **180×180** at `/apple-touch-icon.png`. Wrong size → iOS uses a screenshot of the page as the icon.
3. **Manifest scope is `/companion` only** (correct), so install must be triggered from `/companion` — never from `/`.
4. **iOS Safari has no `beforeinstallprompt`.** Expected; `InstallPwaButton` already shows the right Share-sheet toast on iOS, so the button isn't the bug.

### Fixes (mechanical)
- Generate `public/apple-touch-icon.png` (180×180) from existing 512 source.
- Add `public/companion-icon-192.png` and `companion-icon-256.png` to the manifest icons array.
- Update `index.html`: `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />` (keep the 512 link as fallback); add `<meta name="format-detection" content="telephone=no" />` and `viewport-fit=cover`.
- New **`IphoneInstallHelpCard`** on `/companion`: detects iOS Safari, shows step-by-step (Share → Add to Home Screen), copy-published-URL button, and a one-time toast when `window.location.hostname` looks like the editor preview.
- One-time guidance toast: *"To install on iPhone, publish the project, then open the published URL in Safari (not Chrome iOS — it can't install PWAs)."*

---

## Part 3 — Two-way voice on the Companion (parity with Copilot)

`/copilot` already has the full Deepgram realtime loop:
- `supabase/functions/copilot-voice` — WebSocket: mic → Deepgram STT → AI Gateway → Aura TTS → audio back
- `supabase/functions/deepgram-realtime-token` — short-lived token mint
- `src/pages/Copilot.tsx` — mic UI, partial transcripts, voice/model pickers, transcript log

We reuse it as-is — **no new edge function**.

### 3a. New `src/components/companion/CompanionVoiceDock.tsx` (~250 LOC)
Lifts the mic loop from `Copilot.tsx`:
- Push-to-talk + hands-free toggle (VAD turn-end)
- WebSocket to existing `copilot-voice`
- Persists each turn into the **active companion thread** as `companion_messages` rows (`role: user/assistant`, `model` set to brain in use), so voice + text share one transcript
- Brain call goes through the same context-injection (RAG + `companion-context` from Part 1), so spoken "what are you working on?" gets the live AWIP answer
- Settings drawer: STT model, TTS voice, brain model, daily cost cap, hands-free toggle
- Mic-permission card with iOS-specific copy ("Settings → Safari → Microphone" if denied)

### 3b. Mount
Bottom of `/companion` — visible on desktop, collapsible on mobile.

### 3c. Cost guardrail
Voice turns log to `ai_usage_log` (already wired through `copilot-voice`). Daily cap setting (default $2/day) disables voice when exceeded; surfaced on `AdminAiUsage`.

### 3d. Local vs cloud
Voice always uses the **cloud brain** (Ollama unreachable from phone). Banner: *"Voice mode uses the cloud brain; text mode can stay local."*

---

## Honest answer: will it work on iPhone once installed?

| Capability | In standalone PWA on iPhone | Notes |
|---|---|---|
| Text chat (cloud brain) | ✅ Yes | Streams from `companion-cloud-chat` via fetch + SSE |
| Text chat (local Ollama) | ❌ No | Phone can't reach `localhost:11434` on the Mac. Workaround: Tailscale URL (already documented). |
| RAG against AWIP docs | ✅ Yes | Operator JWT works in standalone PWA. |
| Live AWIP-state injection (Part 1) | ✅ Yes | Same JWT path. |
| **Two-way voice (Part 3)** | ⚠️ Mostly | iOS 16.4+ supports `getUserMedia` + Web Audio in standalone PWAs and WebSocket to `copilot-voice` works. **Caveats:** (a) audio playback gated by first user gesture — first tap unlocks, then fine; (b) screen lock suspends mic — push-to-talk handles this gracefully, hands-free does not; (c) Bluetooth headset routing flaky in standalone PWAs — wired/built-in mic is reliable. |
| Push notifications | ❌ Out of scope | Possible iOS 16.4+ but needs APNs wiring. |
| Background work | ❌ No | iOS suspends standalone PWAs aggressively; not needed for chat/voice. |

**Bottom line:** install works once you publish + ship the icon fix; text + RAG + live-state inject + voice all work in the standalone PWA on iOS 16.4+. Only direct local-Ollama won't (use cloud brain or Tailscale).

---

## Execution order

1. **iPhone install fix** *(~15 min)* — icons + manifest + `IphoneInstallHelpCard` + publish-reminder toast.
2. **`companion-context` edge fn** + per-turn injection in `Companion.tsx` + header pill + auto-refresh.
3. **Two seed buttons** ("What is Lovable doing?", "Operator queue review").
4. **`CompanionVoiceDock`** lifted from `Copilot.tsx`, mounted at the bottom of `/companion`, persisting turns into the active thread.
5. **Daily voice cost cap** setting + `AdminAiUsage` surfacing.
6. *(optional)* Live-doc nightly RAG ingest from `scheduled-morning-review`.

## Out of scope (call out, don't ship)
- Letting the Companion *act* — discussion-only stays; escalation via Promote remains the only write path.
- Streaming Lovable's edit-by-edit activity — no public feed exists; closest proxy is `roadmap_task_activity` + `scheduled-code-review`.
- Push notifications, background sync, native Capacitor wrapper, on-device speech, replacing the cloud-chat path or model selection.

## Files touched (estimate)

**New:**
- `supabase/functions/companion-context/index.ts` (~180 LOC)
- `supabase/functions/companion-context/snapshot.ts` + Deno test
- `src/components/companion/IphoneInstallHelpCard.tsx`
- `src/components/companion/CompanionVoiceDock.tsx` (~250 LOC, lifted from `Copilot.tsx`)
- `public/apple-touch-icon.png` (180×180), `companion-icon-192.png`, `companion-icon-256.png`
- `docs/companion-pwa-ios.md`

**Edited:**
- `src/pages/Companion.tsx` (~120 LOC: fetch+inject, header pill, two seed buttons, prompt update, mount voice dock + help card)
- `index.html`, `public/companion.webmanifest`
- `scripts/ingest-awip-docs.ts` *(only if 1d included)*
- `mem://features/companion` (Phase 1.6 + voice + PWA notes)

## Acceptance
- Ask the Companion *"what are you working on?"* → answers with actual current `roadmap_tasks` + last code-review summary, not paraphrased docs.
- On iPhone Safari at the **published** URL: Share → Add to Home Screen produces a real Companion icon (not a screenshot) and launches standalone.
- In standalone PWA on iPhone: hold-to-talk produces a transcribed user turn, an assistant text reply in the thread, and spoken Aura TTS playback — all written into `companion_messages`.