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

## Part 2 — ✅ Fix iPhone install — *shipped (pending publish)*

### Diagnosis (most likely → least)
1. **Project isn't published.** iOS Safari only offers a real "Add to Home Screen" install when browsing the **published origin in Safari directly** — never inside the Lovable editor preview iframe and never on `id-preview--…lovable.app`. Until you publish + open the live URL in mobile Safari, you get a generic Safari shortcut, not the PWA. **This is the gating step and is the only remaining action.**
2. **Wrong `apple-touch-icon` size.** Was 512×512; iOS expects 180×180. ✅ Fixed.
3. **Manifest scope is `/companion` only** (correct), so install must be triggered from `/companion` — never from `/`.
4. **iOS Safari has no `beforeinstallprompt`.** Expected; `InstallPwaButton` already shows the right Share-sheet toast on iOS.

### Fixes (all shipped)
- ✅ `public/apple-touch-icon.png` (180×180), `companion-icon-192.png`, `companion-icon-256.png` generated.
- ✅ `index.html` updated: 180×180 `apple-touch-icon` link, `viewport-fit=cover`.
- ✅ `public/companion.webmanifest` updated with all icon sizes; scope `/companion`.
- ✅ `src/components/companion/IphoneInstallHelpCard.tsx` — iOS Safari detection, Share→Add-to-Home-Screen steps, copy-published-URL button, editor-preview-origin warning.
- ⬜ Operator action: **publish the project** and open the published URL in iPhone Safari to validate.

---

## Part 3 — 🟡 Two-way voice on the Companion (parity with Copilot)

`/copilot` already has the full Deepgram realtime loop:
- `supabase/functions/copilot-voice` — WebSocket: mic → Deepgram STT → AI Gateway → Aura TTS → audio back
- `supabase/functions/deepgram-realtime-token` — short-lived token mint
- `src/pages/Copilot.tsx` — mic UI, partial transcripts, voice/model pickers, transcript log

We reuse it as-is — **no new edge function**.

### 3a. 🟡 New `src/components/companion/CompanionVoiceDock.tsx` (~250 LOC)
**Status:** stub component shipped + mounted on `/companion` to keep the build green. Full Deepgram loop port pending.

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

## Execution order (current state)

1. ✅ **iPhone install fix** — icons + manifest + `IphoneInstallHelpCard` shipped. ⬜ Operator: publish project to validate end-to-end.
2. ✅ **`companion-context` edge fn** deployed; ✅ `companion-live-state.ts` helper shipped; 🟡 per-turn injection in `Companion.sendMessage()`, header pill, 60s auto-refresh + manual refresh button still pending.
3. ⬜ **Two seed buttons** ("What is Lovable doing?", "Operator queue review") — templates ready, UI not mounted.
4. 🟡 **`CompanionVoiceDock`** — stub mounted; full Deepgram loop lift from `Copilot.tsx` pending.
5. ⬜ **Daily voice cost cap** ($2/day default) setting + `AdminAiUsage` surfacing.
6. 🔵 *(optional)* Live-doc nightly RAG ingest from `scheduled-morning-review`.

## Out of scope (call out, don't ship)
- Letting the Companion *act* — discussion-only stays; escalation via Promote remains the only write path.
- Streaming Lovable's edit-by-edit activity — no public feed exists; closest proxy is `roadmap_task_activity` + `scheduled-code-review`.
- Push notifications, background sync, native Capacitor wrapper, on-device speech, replacing the cloud-chat path or model selection.

## Files touched (status)

**New — shipped:**
- ✅ `supabase/functions/companion-context/index.ts`
- ✅ `src/lib/companion-live-state.ts` (fetcher + Markdown formatter + seed templates)
- ✅ `src/components/companion/IphoneInstallHelpCard.tsx`
- ✅ `src/components/companion/CompanionVoiceDock.tsx` (stub)
- ✅ `public/apple-touch-icon.png` (180×180), `companion-icon-192.png`, `companion-icon-256.png`

**New — pending:**
- ⬜ `supabase/functions/companion-context/snapshot.ts` + Deno test (extracted aggregator)
- ⬜ `docs/companion-pwa-ios.md`

**Edited — shipped:**
- ✅ `index.html`, `public/companion.webmanifest`
- 🟡 `src/pages/Companion.tsx` (imports + voice-dock mount done; live-state injection, header pill, seed buttons pending)

**Edited — pending:**
- ⬜ `scripts/ingest-awip-docs.ts` *(only if 1d included)*
- ⬜ `mem://features/companion` (Phase 1.6 + voice + PWA notes)

## Acceptance
- Ask the Companion *"what are you working on?"* → answers with actual current `roadmap_tasks` + last code-review summary, not paraphrased docs.
- On iPhone Safari at the **published** URL: Share → Add to Home Screen produces a real Companion icon (not a screenshot) and launches standalone.
- In standalone PWA on iPhone: hold-to-talk produces a transcribed user turn, an assistant text reply in the thread, and spoken Aura TTS playback — all written into `companion_messages`.

---

## QA checklist (operator-runnable)

Run top-to-bottom after each shipped slice. Tick each box; if any step fails, file a `discussion_actions` entry and stop before promoting to "done".

### A. Live-state injection (Part 1 acceptance)
Pre-req: at least one `roadmap_tasks` row with `status='in_progress'` and one `scheduled-code-review` run in the last 24h.

- [ ] **A1.** Open `/companion` in desktop browser (logged in as operator).
- [ ] **A2.** In header, confirm pill reads **"Live state ✓ · age <60s"** (not "—" or "stale"). Click manual refresh → age resets to 0–2s.
- [ ] **A3.** DevTools → Network → filter `companion-context` → confirm 200 response, JSON has non-empty `lovable_focus.active_tasks` and `health.last_morning_review`.
- [ ] **A4.** New thread → type *"What are you working on right now?"* → assistant reply must name **at least one real `roadmap_tasks.title`** currently `in_progress` (cross-check against `/roadmap`).
- [ ] **A5.** Reply must reference the **last code-review** (timestamp or finding count) — not a generic "I reviewed the docs…".
- [ ] **A6.** Click **"What is Lovable doing?"** seed button → thread opens pre-populated, first assistant turn cites `roadmap_task_activity` items from the last 24h.
- [ ] **A7.** Click **"Operator queue review"** seed button → assistant lists current open `discussion_actions` with priorities; counts match `/roadmap` Discussion Actions panel.
- [ ] **A8.** Wait 60s without interacting → pill age auto-refreshes back to 0–5s (no manual click needed).

### B. iPhone install (Part 2 acceptance)
Pre-req: project **published** (Publish → Update). Note the `*.lovable.app` URL.

- [ ] **B1.** On iPhone (iOS 16.4+), open the **published** URL in **Safari** (not Chrome, not in-app browser).
- [ ] **B2.** Navigate to `/companion`. `IphoneInstallHelpCard` appears with the 4-step instructions; **no amber "preview origin" warning** is shown.
- [ ] **B3.** Tap Share → scroll → **Add to Home Screen** → confirm the preview thumbnail shows the **Companion icon** (orb/glyph), not a Safari screenshot or letter-on-grey.
- [ ] **B4.** Tap **Add** → home screen shows "Companion" with the correct 180×180 icon (sharp, not pixelated).
- [ ] **B5.** Launch from home screen → app opens **standalone** (no Safari URL bar, no bottom tab bar). Status bar respects `viewport-fit=cover` (content extends under notch correctly).
- [ ] **B6.** In standalone mode, send a text message → cloud reply streams back; RAG citations appear; live-state pill still reads ✓.

### C. Two-way voice (Part 3 acceptance)
Pre-req: B complete (running in standalone PWA on iPhone), `LOVABLE_API_KEY` + `DEEPGRAM_API_KEY` set, daily voice cap not exceeded.

- [ ] **C1.** Voice dock visible at bottom of `/companion`. First tap on mic → iOS permission prompt appears → grant.
- [ ] **C2.** **Push-to-talk:** hold mic, say *"What are you working on?"*, release. Within ~2s a **user message** appears in the thread with your transcribed text (not empty, not "[inaudible]").
- [ ] **C3.** Assistant text reply appears in the thread (same content rules as A4 — names a real in-progress task).
- [ ] **C4.** Aura TTS audio plays through speaker/earpiece automatically (after first-tap unlock). Audio is intelligible, no clipping.
- [ ] **C5.** In `/admin/ai-usage`, confirm a new `ai_usage_log` row for `copilot-voice` with non-zero cost and the operator's user_id.
- [ ] **C6.** **DB check:** `select role, length(content), model from companion_messages where thread_id = '<thread>' order by created_at desc limit 4;` → returns the user (voice) + assistant turns just spoken, with `model` set to the brain in use.
- [ ] **C7.** **Daily cap:** in settings, set cap to $0.01 → next voice attempt is blocked with a clear toast pointing to `/admin/ai-usage`.
- [ ] **C8.** **Lock screen behaviour:** lock phone mid-hold → release after unlock → no crash; transcription either completes or fails gracefully (no silent hang).
- [ ] **C9.** **Hands-free toggle:** enable, speak a short turn, pause → VAD ends turn within ~1.5s and assistant responds without you tapping anything.

### D. Regression sanity (run once after C)
- [ ] **D1.** `/copilot` voice loop still works (we reused, didn't fork).
- [ ] **D2.** `/companion` text-only mode still works with mic permission denied.
- [ ] **D3.** Local Ollama mode (Mac, `use_cloud=false`) still streams — live-state injection should be **skipped** (no JWT to call `companion-context` with from local-only path) or gracefully degraded.
- [ ] **D4.** No new errors in `/admin/logs` in the 10 minutes after the QA run.