# Plan: Unblock the loop

Two parallel tracks. Track A clears the backlog so Phase 2 can close. Track B adds the one-click voice path you asked for.

---

## Track A — Pragmatic cleanup (no new features)

**Goal:** drop everything that doesn't impact future phases. Stop re-auditing the same items.

### A1. Bulk-close Phase 1 todos as `wontfix`
- Query `roadmap_tasks` where `sprint.phase = Phase 1` and `status = 'todo'`.
- For each: read title, decide one of:
  - **Drop** (`status='wontfix'`, note: "Phase 1 sealed — pragmatic close 2026-05-12") — default
  - **Keep** only if it's literally a Phase 2 blocker → move to Phase 2 sprint
- One migration, one batch. No per-item discussion.

### A2. Phase 2 — same treatment for the 8 todos + 2 in_progress
- Read all 10. For each, classify:
  - **Done-by-evidence**: feature exists in code/db → mark `done` with evidence link
  - **Drop**: not needed for Phase 2 sign-off → `wontfix`
  - **Keep**: real blocker → leave as-is, assign owner + due date this week
- Target: ≤3 KEEP. Everything else gone.

### A3. 14 open `discussion_actions`
- For each: KEEP (owner + due_at within 7 days) / DROP (`status='cancelled'`).
- No DEFER, no MERGE — those are loops.

### A4. 12 pending `night_proposals`
- Bulk reject all 12 (`status='rejected'`, reason: "Pragmatic backlog reset").
- Stops the night-shift repeat loop immediately.
- If any look genuinely useful, you accept them manually first; the rest get rejected.

### A5. Phase 2 sign-off attempt
- After A1–A4, run the Phase 2 sign-off flow.
- If a gate fails: fix only that gate. If multiple fail: write an ADR scope-cut and sign off.
- Outcome: Phase 2 → done, Phase 5 → active.

---

## Track B — "Discuss this" voice button (small build)

**Goal:** from any job/finding row, one click → Companion thread pre-loaded with that subject + voice mic already armed.

### B1. Shared component `DiscussThisButton`
- Props: `subject_type`, `subject_id`, `title`, optional `discussion_id`.
- On click: create/find a Companion thread tagged with the subject, navigate to `/companion?thread=<id>&voice=1`.

### B2. Companion auto-arm voice
- `/companion` reads `?voice=1` query param → auto-mounts `VoiceDictateButton` in record state.
- Pre-seeds the thread with a system message: "Discussing {handle}: {title}\n\n{details}".

### B3. Wire it into 3 surfaces (no new pages)
- `JobDetailsDrawer` — header button next to "Promote"
- `Jobs.tsx` card row — small mic icon next to the existing icons
- `MorningReview` panel rows — in the existing action chip strip

### B4. Out of scope (deliberately)
- No bulk voice → bulk-action ("voice close 5 jobs") yet — wait until you've used B1–B3 for a week
- No new Companion page, no new voice provider, no Deepgram realtime upgrade
- TTS playback of the AI reply stays on existing Gemini TTS path

---

## Order of execution
1. A4 (kill night repeat — 1 migration, instant relief)
2. A1 + A2 + A3 (one cleanup migration + one bulk update)
3. B1 → B2 → B3 (build the button)
4. A5 (Phase 2 sign-off attempt)

## Out of scope
- No new sovereignty work
- No Phase 5+ planning until A5 lands
- No refactors "while I'm here"
