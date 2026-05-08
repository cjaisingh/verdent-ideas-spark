## Goal

On each Code review finding card (`/roadmap/risks`), add two **Discuss** buttons stacked above the existing **Acknowledge** button (extra spacing so Acknowledge can't be misclicked):

- **Discuss with Copilot** — opens an in-app voice + text chat with Copilot (Gemini 2.5 Pro), records the full transcript, and lets you record a final decision back on the finding.
- **Discuss (no Copilot)** — sends the finding's context to *this* Lovable chat window so you and I can work it out together. No in-app thread.

## "Discuss (no Copilot)" — route to this chat window

No in-app thread, no new tables for this path. Button behavior:

- Builds a structured markdown payload from the finding (title, severity, category/area, body, timestamp, model, and a stable link `/roadmap/risks#finding-<id>`).
- Copies that payload to the clipboard *and* opens a small modal that:
  - Shows the payload preview.
  - Has a "Copy & open Lovable chat" primary button (copies + flips a hint badge "Paste in Lovable chat to continue").
  - Has a secondary "Mark as 'discussing in Lovable chat'" toggle that flips `discussion_status='in_lovable_chat'` on the finding so the card visibly shows it's under discussion (badge in the header).
- Once you paste it into this chat window, we discuss freely. When we land a decision you can use the same finding card to **Record decision** (see "Final decision" below) — that captures the outcome we agreed on.

## "Discuss with Copilot" — in-app voice + text

### UI
- Clicking the button expands an inline **Discussion** panel under the finding (or opens a Sheet for more room — Sheet preferred since transcripts get long).
- Panel contents:
  - Header: finding title + severity + a "Recording" indicator when voice is active.
  - **Voice controls**: Start / Stop microphone (Deepgram realtime STT — `DEEPGRAM_API_KEY` is already configured). Live partial transcript shown above the input.
  - **Text input** + Send.
  - **Transcript view**: chronological list mixing voice turns (badged `voice`) and typed turns (badged `text`), plus Copilot replies.
  - **Record decision** action (see below).
  - **End discussion** action (closes the panel, marks `discussion_status='resolved'` if a decision was recorded, otherwise `paused`).

### Backend
- New table `roadmap_finding_discussions`:
  - `id`, `finding_id` (FK cascade), `created_at`, `ended_at` (nullable)
  - `mode` (`'copilot'` | `'lovable_chat'`)
  - `started_by_user_id` (uuid)
- New table `roadmap_finding_discussion_messages`:
  - `id`, `discussion_id` (FK cascade), `created_at`
  - `role` (`'user'` | `'copilot'` | `'system'`)
  - `source` (`'voice'` | `'text'` | `'system'`)
  - `body` (text — final transcript text for voice turns; raw text for typed turns)
  - `model` (text, nullable — `'google/gemini-2.5-pro'` for copilot turns)
  - Indexed on `(discussion_id, created_at)`.
- RLS: operator-only on both tables. Realtime publication enabled so the transcript view updates live.

### Edge functions
- `finding-discuss-copilot` (streaming SSE): operator-JWT auth. Receives `{ discussion_id, user_message }`, loads finding context + last N messages, calls Lovable AI Gateway with `google/gemini-2.5-pro` (medium reasoning). Streams the assistant reply tokens back to the client *and* writes the final assistant message into `roadmap_finding_discussion_messages` once complete. System prompt frames Copilot as a senior engineer triaging the finding and pushing toward a recordable decision.
- `deepgram-realtime-token`: operator-JWT auth. Mints a short-lived Deepgram token for the browser to open a WS directly to Deepgram for STT (so we don't proxy audio through our edge function). User audio is transcribed client-side; finalized transcript turns are POSTed to a tiny `finding-discussion-message` insert endpoint (or written via the `supabase-js` client under RLS — the simpler path).

### Final decision
- New columns on `roadmap_review_findings`:
  - `decision_outcome` (text: `accept_risk` | `mitigate` | `convert_to_task` | `dismiss` | null)
  - `decision_summary` (text, nullable — short rationale)
  - `decision_recorded_at` (timestamptz, nullable)
  - `decision_recorded_by` (uuid, nullable)
  - `discussion_status` (text: `none` | `in_lovable_chat` | `copilot_open` | `paused` | `resolved`, default `none`)
- "Record decision" button in both the Copilot panel and the no-Copilot modal. Opens a small form: outcome (radio), summary (textarea, optional). Saves to the finding and (if a Copilot discussion exists) appends a `system` message into the transcript marking the decision.
- The finding card surfaces:
  - Discussion-status badge (e.g. "discussing in Lovable chat", "Copilot session open", "decision: mitigate").
  - When `decision_outcome` is set, the Acknowledge button label flips to **Acknowledge & close** for clarity.

## Layout (the original ask)

Right-side action stack on each finding card:

```text
┌───────────────────────────┐
│ Discuss with Copilot      │  outline, primary
│ Discuss (no Copilot)      │  outline
│                           │  ← mt-6 gap, no divider
│ Acknowledge               │  ghost, smaller
└───────────────────────────┘
```

`flex flex-col gap-2 min-w-[200px]`. Buttons disable while their request is in flight.

## Out of scope (this iteration)

- Resolving / reopening past discussions from a history view — for now you reopen by clicking Discuss again on the finding.
- Notifications, GitHub-issue creation, or external posting.
- Editing or deleting individual transcript messages (system-appended only).
- Multi-user concurrent voice sessions on the same finding (single active session enforced client-side, not server-side).

## Files touched

- `supabase/migrations/<new>.sql` — new tables, new columns on `roadmap_review_findings`, RLS, realtime, indexes.
- `supabase/functions/finding-discuss-copilot/index.ts` — SSE streaming Copilot chat.
- `supabase/functions/deepgram-realtime-token/index.ts` — short-lived STT token minter.
- `src/pages/RiskDashboard.tsx` — button stack, "no-Copilot" modal, Sheet-based Copilot panel, transcript + voice UI, decision form, realtime subscription.
- Small helper `src/lib/findingContext.ts` — builds the markdown payload used by the no-Copilot flow.
