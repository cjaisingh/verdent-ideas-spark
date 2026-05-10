---
name: AWIP Reviews
description: Weekly Monday pull of external review markdown from cjaisingh/verdent-ideas-spark/docs/reviews; each finding becomes RAG + discussion_action + (high/critical) sentinel_finding
type: feature
---

Weekly external reviews ingest pipeline.

- **Source:** `cjaisingh/verdent-ideas-spark/docs/reviews/*.md` (private — needs `GITHUB_REVIEWS_TOKEN`).
- **Cron:** `scheduled-awip-reviews-pull` Mon 05:30 UTC → `awip-reviews-pull/pull` (service token). 30 min before `scheduled-morning-review` so Monday's morning review picks it up.
- **Tables:** `awip_reviews` (raw + parsed, dedupe `source_repo+source_path+file_sha`), `awip_review_findings` (one per finding, links to `discussion_action_id` / `sentinel_finding_id` / `rag_doc_id`).
- **Format:** YAML frontmatter (`review_date`, `reviewer`, `scope`, `summary`, `findings:[{id,title,severity,area,recommendation,evidence,actionable}]`). Falls back to Lovable AI extraction if missing.
- **Severity → priority:** critical→urgent, high→high, medium→med, low→low, info→low. high/critical also open sentinel (`kind=review_finding`, `dedupe_key=review:{repo}:{path}:{ext_id}`).
- **RAG:** every finding indexed under `reviews/<date>/<file>#<ext_id>` (source `review`).
- **Surfaces:** `/reviews` page, `ReviewsCard` on `/roadmap` AutomationPanel, appended to today's `morning_reviews.revisit_items` when new files arrive.
- **Idempotent:** re-running with no new files is a no-op. Per-file errors are stored as `process_status='error'` and surface on `/reviews`.
