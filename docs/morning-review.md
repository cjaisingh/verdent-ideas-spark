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
