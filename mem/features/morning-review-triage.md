---
name: Morning Review triage chips
description: Per-panel Focus/Revisit/Done/Skip chips on /morning-review with Fix/Cancel/Escalate discussion drawer + 3-strikes night auto-escalation
type: feature
---
**Granularity:** one chip per **panel** (not per row). Six panels: `stuck-cron-jobs`, `promotion-drift`, `night-throughput`, `open-findings`, `top-actions`, `revisit`. item_kind is `'panel'`, item_ref is the panel slug.

**Table:** `morning_review_triage` — sticky on `(item_kind, item_ref)` across review_dates. Trigger auto-clears prior active row.

**Focus → discussion drawer:** clicking Focus opens `PanelDiscussionDrawer` backed by `morning_review_discussions` + `morning_review_discussion_messages`. Streams via `morning-review-discuss` (`google/gemini-2.5-pro` → night-cheap fallback).

**Footer = 3 actions, all routed through the `morning-review-resolve` edge function:**
- **Fix** — primary. AI summarizes the chat (3 bullets), inserts a `discussion_actions` row with full details (panel, summary, last 6 turns, link back), `morning_review_panel_ref=<slug>` (unique partial index dedupes open jobs per panel — re-clicks append a note instead of duplicating). Toast: `Queued as job #<short_num>` with **Open** action linking `/jobs?focus=<short_num>`. Outcome=`fixed`, panel triage→`revisit`.
- **Cancel** — destructive. Requires a one-line reason; writes it as a `system` message; outcome=`cancelled`, panel triage→`done`. **No suppression** — if the underlying detector fires again tomorrow it reappears.
- **Escalate** — same as Fix but pre-sets `risk='high'`, `priority='high'`, `night_eligible=false`, AND upserts a `sentinel_findings` row (`kind='operator_escalation'`, `severity='high'`) so it surfaces top of tomorrow's morning review. Outcome=`escalated`.

Defer/Done/Skip removed from the drawer. The panel-header chip strip still has all 4 quick-triage states (no discussion needed).

**3-strikes night auto-escalation:**
- `night-agent` (`open.ts`) inserts one row into `night_shift_job_attempts` per audited action per shift (`outcome='progressed'|'no_change'`).
- View `discussion_actions_stuck_in_night` lists open `night_eligible` actions with `attempts >= 3`.
- Cron `scheduled-night-stuck-escalator` runs daily at 06:05 UTC → calls `night-stuck-escalator` edge function (auth: `x-awip-service-token`) which: flips `risk='high'`, clears `night_eligible`, upserts `sentinel_findings(kind='night_stuck_3x', severity='high')` (idempotent on `dedupe_key=night_stuck_3x:<action_id>`), emits `discussion_action_events(event_type='auto_escalated')`.

**Out of scope:** no suppressions table, no CI-failure auto-escalation (yet), no UI to change the 3-attempts threshold (hardcoded constant).
