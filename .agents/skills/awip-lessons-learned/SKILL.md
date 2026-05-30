---
name: awip-lessons-learned
description: Use on AWIP Core whenever a session, incident, review, or QA failure produces a durable lesson that should be queued for operator review at /admin/lessons. Covers the public.lessons schema, dedupe key, lessonSafety scan, source/cadence values, and the proposed→applied/deferred/rejected lifecycle.
---

# AWIP lessons-learned loop

Use this skill when something durable was learned (incident postmortem, repeated QA fail, sentinel finding pattern, operator correction) and you want it tracked as a reviewable lesson — not lost in chat or a CHANGELOG bullet.

Lessons land in `public.lessons` with `status='proposed'` and surface on `/admin/lessons` (cross-linked from `/morning-review`). Operator transitions to `applied | deferred | rejected` (or `reopened`). Every transition writes a `lesson_events` row.

## When to file a lesson

- A pattern recurred at least twice (same QA gate, same sentinel kind, same operator correction).
- A postmortem identified a rule that would have prevented the issue.
- A weekly/deep audit surfaced a high/critical finding worth a durable rule.
- An operator says "remember this" or "don't do this again" outside a memory-worthy preference (memories are agent-facing; lessons are operator-reviewed).

Do **not** file a lesson for: one-off bugs already fixed, ephemeral session state, agent-only preferences (use `mem://` instead), or anything containing PII/secrets (the safety scan will reject it anyway).

## The contract — `public.lessons`

| Column | Required | Notes |
|---|---|---|
| `category` | yes | Short bucket, e.g. `ci`, `sentinel`, `night-agent`, `migrations`, `auth`. Lowercased + slugged for the dedupe key. |
| `severity` | yes | `low \| medium \| high \| critical`. CHECK-constrained. |
| `title` | yes | ≤200 chars, imperative ("Reclaim stale night jobs every tick"). |
| `recommendation` | yes | ≤2000 chars, the durable rule + how to apply it. |
| `evidence` | yes | `jsonb` array, ≤20 items. Each item: `{ kind, ref, ts? }` (e.g. `{kind:'sentinel_finding', ref:'<uuid>'}`). |
| `dedupe_key` | yes (unique) | `slug(category) + "::" + slug(title)`. Re-inserting the same key updates the existing row. |
| `status` | default `proposed` | Never insert as `applied` from an agent — only the operator approves. |
| `source` | NOT NULL, default `automation` | One of `discussion \| chat \| triage \| event \| automation \| review \| mixed`. Agent-authored lessons use `triage` (incident) or `review` (audit/postmortem). |
| `cadence` | default `weekly` | `daily` or `weekly` — matches which synth job would normally produce it. |
| `source_window_start` / `source_window_end` | optional | Time range the evidence was drawn from. |

`dedupe_key` is computed exactly as in `supabase/functions/lessons-synthesize/dedupe.ts`:

```ts
function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
const dedupe_key = `${slug(category)}::${slug(title)}`;
```

## Two filing paths

### 1. Let the synth job do it (preferred for routine signals)

If the underlying signal already lives in one of the synth inputs — `roadmap_review_findings`, `sentinel_findings`, `qa_checks` (fail), `automation_runs` (error), `night_proposals` — **do nothing extra**. The Sunday 05:00 UTC `lessons-synthesize` cron (or the daily `lessons-daily-synth`) will pick it up next run. Just make sure the source row carries enough detail in its `payload` / `details`.

### 2. Direct insert (incident, postmortem, operator correction)

For agent-authored lessons that won't naturally surface via a synth input, insert directly:

```ts
import { scanLesson } from "@/lib/lessonSafety";

const title = "Reclaim stale night jobs every sentinel tick";
const recommendation = "Call public.reclaim_stale_night_jobs() from sentinel-tick; mark jobs auto_blocked after max_retries.";
const category = "night-agent";

// 1. Safety scan — must return [] for both fields.
const issues = [...scanLesson(title), ...scanLesson(recommendation)];
if (issues.length > 0) throw new Error(`lesson safety: ${issues.map(i => i.kind).join(",")}`);

// 2. Compute dedupe key (same function as synth).
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const dedupe_key = `${slug(category)}::${slug(title)}`;

// 3. Upsert as 'proposed'.
const { error } = await supabase.from("lessons").upsert({
  category,
  severity: "high",
  title,
  recommendation,
  evidence: [
    { kind: "sentinel_finding", ref: findingId },
    { kind: "postmortem", ref: "docs/postmortems/2026-05-30-night-stalls.md" },
  ],
  dedupe_key,
  status: "proposed",
  source: "triage",          // or "review" for audit-driven
  cadence: "weekly",
  source_window_start,
  source_window_end,
}, { onConflict: "dedupe_key" });
```

RLS: only `admin` can write `public.lessons`. From an edge function use the service-role client; from the operator UI the operator's JWT already carries `admin`.

## Lifecycle

```
proposed ──apply──► applied
   │  │
   │  └──defer──► deferred ──reopen──► reopened ──apply──► applied
   │                                     │
   └──reject──► rejected ◄───────────────┘
```

- Only operators move a lesson out of `proposed`. Agents must never insert `applied` directly.
- Every transition writes a `lesson_events` row with `from`/`to`. Use the transition endpoint in `awip-api` or the per-row buttons on `/admin/lessons` — don't `UPDATE` the row in raw SQL or you'll skip the event.
- `applied_as` (`jsonb`) is where the operator records *how* the lesson was applied (PR URL, memory key, ADR ref). Agents may pre-populate it if the lesson is born from a change that's already landed.

## Verification

After filing a lesson, confirm it surfaces correctly:

```sql
select id, status, source, cadence, severity, occurrences
from public.lessons
where dedupe_key = '<your dedupe_key>';

-- Should appear on /admin/lessons under the "Proposed" tab.
-- Cross-link count on /morning-review should bump by 1.
```

If `dedupe_key` already existed, `occurrences` increments and the row stays in its current `status` — that's expected, don't try to reset it.

## References

- Schema: `supabase/migrations/20260509060115_*.sql` (create) + `20260513*` (constraints).
- Synth jobs: `supabase/functions/lessons-synthesize/`, `supabase/functions/lessons-daily-synth/` (both wrap `dedupe.ts`).
- Safety scan: `src/lib/lessonSafety.ts` (client) + mirror in `supabase/functions/awip-api/lessonSafety.ts` (server — keep in sync).
- UI: `src/pages/LessonsLoop.tsx` (`/admin/lessons`), morning-review cross-link in `src/pages/MorningReview.tsx`.
- Doc: `docs/lessons-loop.md`.
- Memory: `mem://features/lessons-loop`.
