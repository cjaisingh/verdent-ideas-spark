## Goal

Make every row in the `/morning-review` Yesterday-tab panels one click away from a voice-armed Companion thread, using the existing `DiscussThisButton` (icon variant).

## Scope

`src/pages/MorningReview.tsx` only. No backend/schema changes. No new components.

## Row-by-row wiring

For each row in the six panel `Section`s, append `<DiscussThisButton variant="icon" .../>` next to the existing right-side badge/button. Subject mapping:

| Panel | subjectType | subjectId | title | details |
|---|---|---|---|---|
| stuck-cron-jobs | `cron_stuck` | `s.job` | `Stuck cron: ${s.job}` | cadence + silent-for line |
| promotion-drift | `promotion_drift` | `d.action_id` | `#${d.short_num} ${d.title}` | `task ${d.task_status} · ${d.promoted_age_hours}h since promotion`; pass `subjectShortNum=d.short_num` |
| night-throughput | `night_throughput` | `review.review_date` | `Night throughput ${review.review_date}` | shifts + summary JSON snippet (one row, placed under the `<pre>`) |
| open-findings | `roadmap_finding` (if `f.source==='code_review'`) else `sentinel_finding` | `f.id` | `f.title` | `${f.source} · ${f.category} · severity ${f.severity}` |
| top-actions | `discussion_action` | `a.action_id` | `#${a.short_num} ${a.title}` | `${a.priority} · ${a.age_hours}h old`; pass `subjectShortNum=a.short_num` |
| revisit | `deferred_item` | `r.id` | `r.title` | `due ${r.defer_until} · severity ${r.severity}` |

Place the icon button immediately to the right of (or just before) the existing trailing element so layout doesn't shift; click handler already does `e.stopPropagation()`.

## Discuss-next strip enhancement (optional, in same edit)

In `DiscussNextStrip`, add a small `DiscussThisButton variant="icon" subjectType="morning_review_panel" subjectId={p.ref} title={p.title}` at the end of each focused/revisit row, so an operator can jump straight to a voice thread for the whole panel without opening the per-panel discussion drawer first. The existing anchor-link behaviour stays.

## Out of scope

- No changes to `PanelDiscussionDrawer` (the in-page chat) — Discuss-this is the lightweight escape hatch to Companion.
- No new tables, no triage interaction, no auto-Focus when clicking Discuss-this.
- No Roadmap / Sentinel / Audits placement — separate ask.

## Verification

- Build passes.
- Manual: load `/morning-review`, click a row's chat icon → routes to `/companion?thread=…&voice=1`, mic auto-arms, seed message contains the panel context.
