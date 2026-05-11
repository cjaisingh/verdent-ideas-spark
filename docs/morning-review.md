# Morning Review (W2)

Daily backlog hygiene snapshot. Runs at **06:00 UTC** via `scheduled-morning-review`
cron and writes one row per day into `public.morning_reviews` (unique on `review_date`).

## What it computes (deterministic, no AI)

- **KPIs (24h):** automation success rate, run count, AI cost, last-seen timestamp per known cron job.
- **Stuck jobs:** any job whose latest `automation_runs` row is older than 2× expected cadence (cadences in `aggregator.ts → DEFAULT_JOB_CADENCES`).
- **Promotion-vs-shipping drift:** open `discussion_actions` with `promoted_task_id` whose linked roadmap task is **not done** ≥ 72h after promotion.
- **Night throughput:** counts + summary from the most recent `night_shifts` row.
- **Open findings:** medium+ unacknowledged from `roadmap_review_findings` **and** open `sentinel_findings` (W3 roll-up).
- **Top 5 actions:** open `discussion_actions` sorted by priority then age.
- **Revisit items:** `deferred_items` whose `defer_until ≤ today`.

## UI

- Page: `/morning-review`
- Operator can **Re-run**, **Acknowledge**, or **Mirror** a row as a new `discussion_actions` entry (one click).
- Cross-link to `/admin/lessons` showing the count of `lessons` in `proposed` status.

## Files

- `supabase/functions/morning-review/aggregator.ts` — pure aggregator (covered by 7 Deno tests).
- `supabase/functions/morning-review/index.ts` — fetcher + upsert + alerts.
- `src/pages/MorningReview.tsx`

## Testing

```bash
deno test supabase/functions/morning-review/aggregator_test.ts
```

Manual:
```bash
curl -X POST https://<ref>.supabase.co/functions/v1/morning-review \
  -H "x-service-token: $AWIP_SERVICE_TOKEN"
```

## Triage chips

Each row in every Yesterday-tab panel has a 4-state segmented control:

- **Focus** — discuss now. Aggregated into the "Discuss next" strip at the top of the page.
- **Revisit** — come back to it, not today.
- **Done** — resolved, no discussion needed.
- **Skip** — not actionable, ignore in future reviews.

Click an active chip again to clear it back to neutral.

State is **sticky on `(item_kind, item_ref)`** — the same finding keeps its triage state across review_dates until you change or clear it. Storage is `morning_review_triage` with an audit trail (each insert clears the prior active row via trigger, but old rows remain queryable).

A `Hide cleared` toggle in the page header (default on, persisted in localStorage) hides Done + Skip rows. Cleared rows that remain visible dim to 50% opacity. Panel headers show `Focus N / Revisit N` count badges.

See: `mem://features/morning-review-triage`.
