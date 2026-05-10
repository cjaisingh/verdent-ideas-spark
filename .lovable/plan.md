## Goal

Every Monday morning, AWIP pulls new review files from `cjaisingh/verdent-ideas-spark/docs/reviews`, stores them, indexes them into RAG, opens sentinel findings for high-severity items, and creates `discussion_actions` for everything actionable — landing in the **Monday morning review** automatically.

## Blocker to confirm first

`https://github.com/cjaisingh/verdent-ideas-spark/tree/main/docs/reviews` returns **404 (unauthenticated)**. The sandbox has no GitHub auth — public repos work, private ones don't. Two possible fixes (the implementation supports both):

1. Make the repo (or just `docs/reviews`) **public** → no secret needed, fetch via `raw.githubusercontent.com`.
2. Keep it private → add a fine-grained PAT as secret **`GITHUB_REVIEWS_TOKEN`** with read access to that repo. Implementation will use it if present.

I'll build it so it works either way; if both the public fetch and (optional) PAT fail, the run logs an error and surfaces in `/morning-review`.

## File format contract (markdown + frontmatter)

```text
---
review_date: 2026-05-11
reviewer: hermes-agent           # or chatgpt, claude, human
scope: weekly                    # weekly | adhoc
summary: One-line gist
findings:
  - id: f1
    title: Sentinel false-positives on quiet hours
    severity: high               # info | low | medium | high | critical
    area: sentinel               # module/page/system
    recommendation: Suppress checks 22:00–06:00 UTC
    evidence: "link or quote"
    actionable: true
---

# Long-form notes...
```

Parser rules: missing frontmatter → AI fallback (`gemini-2.5-flash-lite`) extracts the same shape; unknown severities → `info`; `actionable:false` → store + index only, no action created.

## Database

```sql
-- Raw stored reviews (one row per file)
create table awip_reviews (
  id uuid pk,
  source_repo text not null,            -- 'cjaisingh/verdent-ideas-spark'
  source_path text not null,            -- 'docs/reviews/2026-05-11.md'
  file_sha text not null,               -- GitHub blob sha, dedupe key
  review_date date,
  reviewer text,
  scope text,
  summary text,
  raw_markdown text not null,
  parsed jsonb,                         -- normalized findings array
  fetched_at timestamptz default now(),
  processed_at timestamptz,             -- null until acted on
  process_status text default 'pending',-- pending | processed | error
  process_error text,
  unique (source_repo, source_path, file_sha)
);

-- One row per finding (so we can dedupe + link to actions/findings)
create table awip_review_findings (
  id uuid pk,
  review_id uuid references awip_reviews(id) on delete cascade,
  ext_id text,                          -- frontmatter id
  title text not null,
  severity text not null,
  area text,
  recommendation text,
  evidence text,
  actionable boolean default true,
  discussion_action_id uuid,            -- set once promoted
  sentinel_finding_id uuid,             -- set if high/critical
  rag_doc_id uuid,                      -- set after indexing
  created_at timestamptz default now()
);
```

RLS: operator-only RW on both tables; realtime enabled. Indexes on `(source_repo, source_path)`, `(severity)`, `(processed_at)`.

## Edge function: `awip-reviews-pull`

Auth: `x-awip-service-token` (cron) or operator JWT (manual).

Pipeline (idempotent):

1. **List** files in `docs/reviews/` via GitHub API (`/repos/{owner}/{repo}/contents/docs/reviews?ref=main`). Auth header only if `GITHUB_REVIEWS_TOKEN` is set.
2. For each `.md` file: skip if `(source_path, file_sha)` already in `awip_reviews`.
3. **Fetch** raw markdown (`raw.githubusercontent.com` or contents API).
4. **Parse** frontmatter (`gray-matter`-equivalent in Deno). On failure, call Lovable AI (`gemini-2.5-flash-lite` — already night-window-cheap) with a strict schema prompt to extract findings.
5. **Insert** into `awip_reviews` + `awip_review_findings`.
6. For each finding:
   - **Always:** index into RAG via existing `awip_docs` / `awip_doc_chunks` (path = `reviews/<date>-<id>`, title = finding title, content = recommendation+evidence+area). Stamp `rag_doc_id`.
   - **If `severity in ('high','critical')`:** insert `sentinel_findings` (`kind='review_finding'`, dedupe by `ext_id`). Stamp `sentinel_finding_id`.
   - **If `actionable=true`:** insert `discussion_actions` with `source='extracted'`, `night_eligible=true`, `priority` mapped from severity (`critical→p0, high→p1, medium→p2, low→p3, info→p4`), `extracted_confidence=0.9` (frontmatter) or AI confidence (fallback). Stamp `discussion_action_id`.
7. Mark `processed_at`, `process_status='processed'`. On error per file, set `process_status='error'` + `process_error` and continue.
8. Return `{ scanned, new_files, findings_created, actions_created, sentinel_opened }`.

## Cron

`scheduled-awip-reviews-pull` — `0 7 * * 1` (07:00 UTC = **08:00 BST Mon**), invokes the function with the service token. Runs **before** the 06:00 UTC morning-review aggregator on Monday — so to actually fold into Monday's morning review the function must run first. **Adjust:** schedule at `30 5 * * 1` (05:30 UTC) so reviews are ingested 30 min before the morning-review job. (You said files generate ~08:00 BST = 07:00 UTC — clarify in Q below; I default to 05:30 UTC and add a manual "Pull now" button on `/morning-review`.)

> ⚠ The morning-review aggregator already runs daily at 06:00 UTC. If review files only arrive ~07:00 UTC Monday, Monday's automated review will miss them. Options:
> - **A.** Move Monday's morning-review run to 07:30 UTC (only Monday).
> - **B.** Keep 06:00 UTC and have the pull function **append** to today's morning-review row when it runs at 07:30 UTC.
> - **C.** Push your review file generation earlier (≤ 05:30 UTC).

I'll implement **B** by default (least disruptive) — the pull function upserts into `morning_reviews` adding a `## Weekly Reviews` section.

## UI

- **`/morning-review`** — new "Weekly Reviews" card listing latest `awip_reviews` (date, reviewer, # findings, severity badges). Manual "Pull reviews now" button → invokes `awip-reviews-pull`.
- **`/roadmap` AutomationPanel** — small tile "Awip Reviews: last pulled <relative time>, N new findings this week".
- **New page `/reviews`** — full history, expandable finding rows with links to created `discussion_action` / `sentinel_finding`.

## Docs + memory

- `docs/awip-reviews.md` — frontmatter schema, pipeline, troubleshooting.
- `mem://features/awip-reviews` — added to index Core (cadence + dedupe rule).
- README + CHANGELOG updated.

## Out of scope (v1)

- Writing reviews back to GitHub.
- Multi-repo sources (single repo hardcoded; configurable via `app_secrets` later).
- Auto-closing actions when a follow-up review marks a finding resolved (logged as todo).

## One open question

The Monday morning-review job runs at **06:00 UTC**. If reviews arrive ~07:00 UTC, today's automated review misses them unless we either pull earlier or append after. Default plan = **append after** (option B above). Confirm or pick A/C and I'll adjust the cron.
