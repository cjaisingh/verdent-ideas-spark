# AWIP Reviews

Weekly external reviews (e.g. Hermes Agent, ChatGPT, Claude, human) are dropped into a separate GitHub repo and pulled into AWIP every Monday morning. Each finding becomes:

- a row in `awip_review_findings`
- a chunk in the RAG index (`awip_docs` / `awip_doc_chunks`, source = `review`)
- if severity ≥ high: a `sentinel_findings` row (kind = `review_finding`)
- if `actionable !== false`: a `discussion_actions` row (`subject_type = 'awip_review'`, `night_eligible = true`, priority mapped from severity)

## Source

| Field | Value |
| --- | --- |
| Repo | `cjaisingh/verdent-ideas-spark` |
| Path | `docs/reviews/*.md` |
| Branch | `main` |
| Auth | `GITHUB_REVIEWS_TOKEN` (fine-grained PAT, contents:read) — required because the repo is private. |

## File format (frontmatter contract)

```yaml
---
review_date: 2026-05-11
reviewer: hermes-agent       # hermes-agent | chatgpt | claude | human
scope: weekly                # weekly | adhoc
summary: One-line gist of the week
findings:
  - id: f1
    title: Sentinel false-positives during quiet hours
    severity: high           # info | low | medium | high | critical
    area: sentinel           # module/page/system this affects
    recommendation: Suppress checks 22:00–06:00 UTC for low-severity probes
    evidence: "ref or quote"
    actionable: true         # default true; false = info-only (RAG-indexed, no action)
---

# Long-form notes (not parsed; ignored by the pipeline)
```

If the frontmatter is missing or malformed, the pipeline falls back to Lovable AI (`pickModel("google/gemini-2.5-flash")` — drops to `gemini-2.5-flash-lite` during the night window) to extract the same shape.

## Severity → priority mapping

| Severity | discussion_action.priority | Sentinel? |
| --- | --- | --- |
| critical | `urgent` | ✓ |
| high | `high` | ✓ |
| medium | `med` | — |
| low | `low` | — |
| info | `low` | — |

## Pipeline

1. List `docs/reviews/*.md` via the GitHub contents API.
2. Skip files already in `awip_reviews` (deduped by `(source_repo, source_path, file_sha)`).
3. Fetch raw markdown.
4. Parse frontmatter (YAML) → `ParsedReview`. AI fallback if needed.
5. Insert `awip_reviews` row.
6. For each finding: index in RAG, optionally open sentinel, optionally create discussion action, then insert `awip_review_findings` linking everything together.
7. Mark review `processed` (or `error` with message).
8. If any new files were ingested, append a `revisit_items` entry to today's `morning_reviews` row (creating it if absent).

The whole pipeline is idempotent — re-running with no new files is a no-op.

## Cron

`scheduled-awip-reviews-pull` — Monday `30 5 * * 1` (05:30 UTC), invokes `awip-reviews-pull/pull` with `x-awip-service-token`. Runs 30 min before the regular `scheduled-morning-review` so the new findings show up in Monday's morning review. Manual "Pull now" button on `/reviews` and on `AutomationPanel`.

## Surfaces

- **`/reviews`** — full history with collapsible findings, links to the action / sentinel finding.
- **`/roadmap` AutomationPanel** — `ReviewsCard` shows last pull + Pull-now button.
- **`/morning-review`** — Monday's review surfaces "weekly_reviews" entry under revisit items.

## Future (deferred)

- Auto-resolving sentinel findings when a follow-up review confirms a fix.
- Multi-repo / multi-folder ingestion (currently the source is hardcoded).
- Writing the AWIP response back into the review repo as a PR comment.
