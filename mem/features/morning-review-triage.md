---
name: Morning Review triage chips
description: Per-panel Focus/Revisit/Done/Skip chips on /morning-review with sticky state and Discuss-next strip
type: feature
---
**Granularity:** one chip per **panel** (not per row). Six panels: `stuck-cron-jobs`, `promotion-drift`, `night-throughput`, `open-findings`, `top-actions`, `revisit`. item_kind is `'panel'`, item_ref is the panel slug.

**Table:** `morning_review_triage` (`item_kind`, `item_ref`, `state` in focus/revisit/done/skip, `note`, `set_by`, `set_at`, `cleared_at`). Unique partial index on `(item_kind, item_ref) where cleared_at is null` — at most one active row per (kind, ref). Trigger `morning_review_triage_clear_previous` auto-clears the prior active row on insert, preserving full audit history. View `morning_review_triage_active` (security_invoker). Operator/admin RLS via `has_role()`, realtime on. Schema accepts row-level kinds too (discussion_action / sentinel_finding / etc.) but UI currently only writes `'panel'`.

**Frontend:**
- `src/hooks/useMorningReviewTriage.ts` — loads active rows once, exposes `getState/setState`, realtime channel `mr-triage-<random>` (per-mount unique).
- `src/components/morning-review/TriageChip.tsx` — 4-segment control. Click active chip again to clear.
- `src/components/morning-review/DiscussNextStrip.tsx` — top card listing all panels currently in Focus or Revisit, anchor-linked to `#panel-<slug>`.
- `src/pages/MorningReview.tsx` — chip in each panel header next to the title; small state badge in title; Done/Skip panels dim to ~60% opacity.

**Sticky behavior:** triage state is keyed on `(item_kind, item_ref)` and persists across review_dates until the operator changes or clears it.

**Focus → discussion drawer:** clicking Focus also opens `PanelDiscussionDrawer` (right-side Sheet) backed by tables `morning_review_discussions` (unique-open per `(review_id, panel_ref)`, outcome stamped on close) and `morning_review_discussion_messages` (operator/admin RLS + realtime). Edge function `morning-review-discuss` streams via Lovable AI Gateway with `pickModel('google/gemini-2.5-pro')` (auto-falls to gemini-2.5-flash-lite in night window), wrapped with `withLogger`, logs to `ai_usage_log`. Footer has 4 resolution buttons that close the loop and stamp triage: **Mirror** (insert `discussion_actions` → revisit), **Defer** (insert `deferred_items` due tomorrow → revisit), **Done** (→ done), **Skip** (→ skip). Re-clicking Focus on a panel with an existing open discussion resumes the same thread.

**Out of scope:** does not feed Tomorrow Plan, no auto-suggest from severity, no UI for triage history, no tool-calling in the chat (resolution actions are the 4 footer buttons).
