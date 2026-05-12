# Playbook — Voice setup + chat-first for policy work

Source of truth for two interlocking lessons learned in May 2026. Anything
that touches voice pipelines or "should we monitor / threshold / alert on X"
must follow this checklist before code is written.

In-app surface: `/playbooks/voice-chat-first`. Memory mirror:
`mem://preferences/chat-first-policy-requests` and `mem://features/voice-health`.

---

## 1. Voice setup timeline (what we shipped, in order)

The wizard at `/voice-setup` exists because we kept rebuilding the same
five steps ad-hoc. Future voice work follows this order. Skipping a step
is a defect.

1. **Confirm scope** via `ask_questions` (≤4): browser only, browser + Rork,
   diagnostics only.
2. **Pick providers**: TTS default `gemini-tts`; STT default browser Web Speech.
   Any other provider needs a secret + a cost note before code.
3. **Persist config** in `voice_config` (operator-scoped, RLS, realtime).
   Never localStorage for shared state — Rork reads the table directly.
4. **Validate end-to-end** with at least:
   - Mic permission + level meter peak ≥ 25.
   - Full loop: STT → `companion-cloud-chat` → `gemini-tts` playback,
     logged through `ai_usage_log`.
5. **Observe** at `/admin/voice-health`. Bands: green &lt; 2% errors,
   amber 2–10%, red &gt; 10% OR no success in 60min over a 1h window for
   `gemini-tts`, `companion-cloud-chat`, `telegram-send-voice`.
   Sentinel kind `voice_pipeline_red` (high) auto-fires and rolls into
   morning review.

### Standing constraints
- TTS bypasses the night-cheap model policy — `gemini-tts` always uses the
  requested TTS model.
- Browser Web Speech leaves no server trace; STT health is "n/a" on the
  dashboard. To monitor STT, route through a beacon or switch to a server
  STT provider.
- Rork iPhone reads `voice_config` directly — schema changes need the
  Expo app updated in lockstep (`docs/rork-companion-spec.md`).

---

## 2. Chat-first lesson (when to talk before you code)

Hard rule: **policy/threshold-shaped requests require a confirmation chat
before any migration or edge code is written.**

### Triggers (any one is enough)
- Words: monitor, alert, threshold, SLA, SLO, eligibility, auto-X.
- A number a human had to pick (rate, window, count, age).
- A who/when decision (who gets paged, when does it fire).
- A request dressed as "build" but really design ("set up monitoring for…").

### Required questions (≤4, batched)
1. **Event definition + signal source.** Which table/field/log line is the
   ground truth? Server-side rows only — client-only signals don't count
   unless we beacon them.
2. **Thresholds + window + severity tiers.** Concrete numbers, not
   adjectives. Default to 1h windows for live ops; 24h for trends.
3. **Who/what gets notified.** Page-only, sentinel finding, Telegram alert,
   or escalation chain.
4. **Scope of this turn.** Minimum viable vs full build. Default to minimum
   viable; expand only on next turn.

### Out of scope (skip the chat, build immediately)
- Deterministic edits where every number/target is named.
- Pure UI/visual refinements.
- Unambiguous bug fixes against a known reproducer.

### What this prevents
- Numbers chosen by the AI rather than the operator (compliance risk).
- Monitors that fire on metrics nobody can act on.
- Rebuild cycles when the operator's mental model differs from the build.

---

## 3. Cross-references

- `mem://preferences/chat-first-policy-requests` — the rule.
- `mem://features/voice-health` — voice dashboard contract.
- `mem://features/gemini-tts` — TTS function contract.
- `mem://features/companion` — companion chat surface.
- `docs/rork-companion-spec.md` — iPhone surface contract.
- `/voice-setup` — the wizard.
- `/admin/voice-health` — the dashboard.

---

## 4. Update protocol

This file is the source of truth. To revise:
1. Edit this markdown.
2. Update the matching memory entry if the rule changes.
3. Note the change in `CHANGELOG.md`.
4. The in-app page (`src/pages/PlaybookVoiceChatFirst.tsx`) mirrors the
   text — keep both in sync in the same commit.
