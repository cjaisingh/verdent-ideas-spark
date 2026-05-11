## Goal

Make Morning Review actionable: clicking **Focus** on a panel opens a side chat where you and the AI can discuss that panel's findings, agree a strategy, mirror an action, or dismiss.

## Behavior

1. Click **Focus** on any panel header → triage state still saves as `focus`, but a right-side **Discussion Drawer** also opens, scoped to that panel.
2. Drawer header shows panel title + the panel's current data (stuck jobs / findings / actions / etc.) as a compact context card.
3. Chat thread below: AI is pre-seeded with the panel's JSON payload + a system prompt ("you are reviewing the morning review panel X for date Y, help the operator decide: clarify, agree strategy, fix, or defer").
4. Operator types freely. Streaming responses via Lovable AI Gateway (`google/gemini-3-flash-preview`, falls back to night-cheap model in night window via existing `pickModel`).
5. Drawer footer has 4 quick-resolution buttons that close the loop:
   - **Mirror as action** → inserts `discussion_actions` row (existing pattern), marks panel `revisit`.
   - **Defer** → inserts `deferred_items`, marks panel `revisit`.
   - **Mark done** → sets panel triage to `done`, closes drawer.
   - **Skip** → sets panel triage to `skip`, closes drawer.
6. Re-clicking Focus on a panel that already has a discussion re-opens the same thread (sticky on `(review_id, panel_ref)`).
7. Other chips (Revisit / Done / Skip) keep current behavior — no drawer.

## Storage

New table `morning_review_discussions`:
- `id`, `review_id` (fk `morning_reviews`), `panel_ref` (text, e.g. `stuck-cron-jobs`), `created_by`, `created_at`, `closed_at`, `outcome` (focus/mirrored/deferred/done/skipped/null).
- Unique on `(review_id, panel_ref)` where `closed_at is null`.

New table `morning_review_discussion_messages`:
- `id`, `discussion_id` (fk), `role` (user/assistant/system), `content`, `created_at`, `model`, `tokens_in`, `tokens_out`.

Operator-only RLS via `has_role()`, realtime on both. Standard timestamps trigger.

## Edge function

`morning-review-discuss` (new, wrapped with `withLogger`):
- Auth: operator JWT.
- Input: `{ discussion_id, messages: UIMessage[] }`.
- Loads panel context from `morning_reviews` + panel_ref, builds system prompt.
- Streams via AI SDK `streamText` + `createLovableAiGatewayProvider` + `pickModel('google/gemini-3-flash-preview')`.
- `onFinish` saves assistant message; user messages saved client-side before invoke.
- Logs to `ai_usage_log` (existing pattern).

## Frontend

- New `src/components/morning-review/PanelDiscussionDrawer.tsx` — Sheet from right, AI Elements primitives (`Conversation`, `Message`, `MessageResponse`, `PromptInput`, `Shimmer`), 4 footer resolution buttons.
- New `src/hooks/useMorningReviewDiscussion.ts` — open/close, load history, send message via `useChat` with custom transport pointing at the edge function.
- `useMorningReviewTriage.setState`: when new state is `focus`, also call `openDiscussion(panelRef)` (passed in via props).
- `MorningReview.tsx` `Section`: pass `onFocus` callback; render the drawer once at page level keyed by active panel.
- `DiscussNextStrip`: clicking a Focus chip opens the drawer for that panel instead of just scrolling.

## Out of scope

- No tool-calling in the chat (read-only context, action via the 4 footer buttons).
- No per-row discussions — panel-level only, matches existing triage granularity.
- No reuse across review_dates (each day's review gets its own discussions; sticky triage state is unchanged).

## Files

**New**
- `supabase/migrations/<ts>_morning_review_discussions.sql`
- `supabase/functions/morning-review-discuss/index.ts`
- `src/components/morning-review/PanelDiscussionDrawer.tsx`
- `src/hooks/useMorningReviewDiscussion.ts`

**Edited**
- `src/pages/MorningReview.tsx` (wire drawer + onFocus)
- `src/components/morning-review/DiscussNextStrip.tsx` (open drawer on click)
- `src/hooks/useMorningReviewTriage.ts` (optional `onFocus` side-effect callback)
- `docs/morning-review.md`, `mem/features/morning-review-triage.md`, `mem/index.md`, `CHANGELOG.md`
