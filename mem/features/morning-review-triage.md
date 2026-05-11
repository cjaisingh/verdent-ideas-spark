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

**Out of scope:** does not feed Tomorrow Plan, no auto-suggest from severity, no UI for triage history.
