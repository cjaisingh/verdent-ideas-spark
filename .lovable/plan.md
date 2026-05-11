## Morning Review Triage

Add a 4-state triage chip (**Focus · Revisit · Done · Skip**) to every row in every panel on `/morning-review` (Yesterday tab). State is sticky per item across review dates — set it once and it carries forward until you flip it.

### How it feels

- Each row gets a small segmented control on the right (next to existing badges/Mirror buttons).
- Default state is **unset** (neutral). Click sets Focus / Revisit / Done / Skip.
- Each panel header gets a count chip: `Focus 3 · Revisit 1`.
- A new top strip "**Discuss next**" pulls every Focus item across all 6 panels into one ordered list — that's your morning agenda.
- "Done" and "Skip" rows dim to ~50% opacity so attention stays on Focus/Revisit/unset.
- A header filter toggle: `Hide cleared` (hides Done + Skip rows) — on by default.

### Color/semantic mapping

- **Focus** — primary, solid. "Talk about this now."
- **Revisit** — amber/warning. "Come back to it, not today."
- **Done** — muted/success outline. "Resolved, no discussion needed."
- **Skip** — muted outline. "Not actionable, ignore in future reviews too."

### Sticky behavior

State is keyed on the underlying `item_ref` (e.g. `discussion_action:<id>`, `sentinel_finding:<id>`, `roadmap_review_finding:<id>`, `cron:<job>`, `deferred:<id>`, `drift:<action_id>`, `night_throughput:<shift_id>`). When tomorrow's review renders the same finding, its triage state is preserved. Flip it to a new value (or click the active chip again to clear) to reset.

### Technical section

**New table** `public.morning_review_triage`
- `id uuid pk`
- `item_kind text` — one of `discussion_action | sentinel_finding | code_review_finding | cron_stuck | deferred | promotion_drift | night_throughput`
- `item_ref text` — stable id (uuid string, job name, etc.)
- `state text` — `focus | revisit | done | skip`
- `note text null` — optional one-liner
- `set_by uuid` (auth.uid)
- `set_at timestamptz default now()`
- `cleared_at timestamptz null`
- Unique partial index on `(item_kind, item_ref) where cleared_at is null` so each item has exactly one active state.
- RLS: operator/admin only via `has_role()`, same pattern as other Morning Review tables.
- Realtime: add to `supabase_realtime` publication.
- Trigger: when a new state is inserted for an `(item_kind, item_ref)`, set `cleared_at = now()` on the previous active row (acts as audit history).

**Helper view** `morning_review_triage_active` — `select distinct on (item_kind, item_ref) ...where cleared_at is null` for fast lookup.

**Frontend**
- New component `src/components/morning-review/TriageChip.tsx` — 4-segment control + "clear" affordance on active. Uses semantic tokens (`primary`, `warning`, `muted`, `destructive`).
- New hook `src/hooks/useMorningReviewTriage.ts` — fetches all active triage rows once (small table), exposes `getState(kind, ref)` + `setState(kind, ref, state)` with optimistic update + realtime channel `mr-triage-live` (unique per mount, per channel-naming preference).
- New component `src/components/morning-review/DiscussNextStrip.tsx` — renders above the KPI grid; lists every Focus item with a one-line summary and a jump-to-panel anchor.
- `src/pages/MorningReview.tsx` — render `<TriageChip kind="..." ref={item.id} />` on each row in all 6 `Section`s; render `<DiscussNextStrip />` between header and KPI tiles; add panel-header counts; add `Hide cleared` toggle in page header (persisted to localStorage).
- No changes to `morning-review` edge function or aggregator — triage is pure operator UI state on top of the existing snapshot.

**Item-ref resolution per panel**
- Stuck cron jobs → `cron_stuck` / `s.job`
- Promotion drift → `promotion_drift` / `d.action_id`
- Night throughput → `night_throughput` / `review.night_throughput.last_window_end || review.id` (single row)
- Open findings → `sentinel_finding` or `code_review_finding` based on `f.source` / `f.id`
- Top 5 actions → `discussion_action` / `a.action_id`
- Revisit items → `deferred` / `r.id`

**Out of scope** (explicit, per your answers)
- No auto-population of Tomorrow Plan from Focus.
- No auto-suggest from severity — operator chooses.
- No editing UI for triage history; the audit row exists in the table but isn't surfaced.

### Files to add
- `supabase/migrations/<ts>_morning_review_triage.sql`
- `src/components/morning-review/TriageChip.tsx`
- `src/components/morning-review/DiscussNextStrip.tsx`
- `src/hooks/useMorningReviewTriage.ts`
- `docs/morning-review.md` (append "Triage" section)
- `mem/features/morning-review-triage.md` + index entry

### Files to edit
- `src/pages/MorningReview.tsx` — wire chips, strip, counts, hide-cleared toggle
- `CHANGELOG.md`
