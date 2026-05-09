# Lessons-Learned Loop (W4)

Weekly AI synthesis of operational signals into durable, dedupable rules
stored in `public.lessons`. Runs via `scheduled-lessons-weekly` cron
(`0 5 * * 0` — Sunday 05:00 UTC).

## Inputs (last 7 days)

- `roadmap_review_findings`
- `sentinel_findings`
- `qa_checks` (status='fail')
- `automation_runs` (status='error')
- `night_proposals`

If all are empty, the function records a noop run and exits without calling AI.

## AI

- Model selected by `pickModel("google/gemini-2.5-flash")` — switches to the
  cheap night model between 22:00–06:00 UTC.
- `response_format: { type: "json_object" }` for strict structured output.
- Returned lessons are normalised + deduped (`category::title`, slugified) before upsert.

## Lifecycle

`proposed → applied | deferred | rejected` (with `reopened` allowed).
All transitions log a `lesson_events` row with `from`/`to`.

## UI

- Page `/admin/lessons` — tabs by status, free-text search, per-row Apply/Defer/Reject.
- Cross-link from `/morning-review` shows count of `proposed` lessons.

## Testing

```bash
deno test supabase/functions/lessons-synthesize/dedupe_test.ts
```
