---
name: Morning Review triage chips
description: Per-item Focus/Revisit/Done/Skip chips on /morning-review with sticky state and Discuss-next strip
type: feature
---
**Table:** `morning_review_triage` (`item_kind`, `item_ref`, `state` in focus/revisit/done/skip, `note`, `set_by`, `set_at`, `cleared_at`). Unique partial index on `(item_kind, item_ref) where cleared_at is null` — at most one active row per item. Trigger `morning_review_triage_clear_previous` auto-clears the prior active row on insert, preserving full audit history. View `morning_review_triage_active` (security_invoker) returns just the live state. Operator/admin RLS via `has_role()`, realtime publication enabled.

**Item kinds:** `discussion_action`, `sentinel_finding`, `code_review_finding`, `cron_stuck` (item_ref = job name), `deferred`, `promotion_drift` (item_ref = action_id), `night_throughput` (item_ref = last_window_end).

**Frontend:**
- `src/hooks/useMorningReviewTriage.ts` — loads active rows once, exposes `getState/setState/counts`, realtime channel `mr-triage-<random>` (per-mount unique).
- `src/components/morning-review/TriageChip.tsx` — 4-segment control. Click active chip again to clear.
- `src/components/morning-review/DiscussNextStrip.tsx` — top card listing every Focus item across all panels with anchor links to `#panel-<slug>`.
- `src/pages/MorningReview.tsx` — chip on every row, panel headers show `Focus N / Revisit N` badges, `Hide cleared` toggle (default on, persisted in localStorage `mr-hide-cleared`) hides Done+Skip rows, cleared rows otherwise dim to 50%.

**Sticky behavior:** triage state is keyed on `(item_kind, item_ref)` and persists across review_dates until the operator changes or clears it. No daily reset.

**Out of scope:** does not feed Tomorrow Plan, no auto-suggest from severity, no UI for triage history.

