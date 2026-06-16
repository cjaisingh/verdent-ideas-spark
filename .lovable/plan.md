## Goal

Add a self-contained HTML report as an **additional** output for Deep Audit and AWIP Reviews runs. Markdown / DB rows stay the source of truth; HTML is a renderable view written to Storage and linked from the existing surfaces.

## Non-goals

- Not converting `docs/**`, `mem/**`, ADRs, CHANGELOG, plans, or runbooks to HTML.
- Not changing the ingestion pipelines (`awip-reviews-pull` still parses markdown frontmatter; `ingest-awip-docs.ts` still walks `*.md`).
- No editor / interactivity in the HTML — read-only report with inline SVG charts.

## Shape of the report

One file per run, ~single-page, self-contained (inline CSS + SVG, no external assets):

- Header: run id, kind (weekly/monthly/review), generated_at, source (audit module set or review file path + sha).
- Summary band: counts by severity, week-over-week delta.
- Inline SVG bar chart: findings by severity; second chart by area/module.
- Findings table: severity chip, area, title, recommendation, link back to the `sentinel_findings` / `discussion_actions` / `awip_review_findings` row in the app.
- Footer: "Source of truth: row ids + table names" so the operator can grep.

## Storage + retention

- New private bucket `audit-reports`, operator-only RLS on `storage.objects`.
- Path: `deep-audit/<run_id>.html`, `awip-reviews/<review_id>.html`.
- Signed URL minted on demand from the UI (no public bucket).
- Retention piggybacks on existing audit/review row retention — delete row → delete object via a small cleanup step in the existing cron.

## Schema

Add nullable columns, no new tables:

- `deep_audit_runs.report_html_path text`
- `awip_reviews.report_html_path text`

Migration includes the column adds only; bucket created via `supabase--storage_create_bucket` + RLS policy migration on `storage.objects`.

## Edge function changes

Shared renderer in `supabase/functions/_shared/html-report.ts`:

- `renderAuditReport(run, findings): string`
- `renderReviewReport(review, findings): string`
- Pure string templating, escapes all interpolations, inline `<style>`, inline `<svg>` for charts (computed server-side from finding counts — no JS).

Wired into the existing functions (no new cron, no new endpoints):

- `deep-audit` (weekly + monthly entry points): after findings are written, render → upload to `audit-reports/deep-audit/<run_id>.html` → update `report_html_path`.
- `awip-reviews-pull`: after a review's findings are fanned out, render → upload → update `report_html_path`.

Both wrapped with existing `withLogger`. Idempotent: re-running overwrites the object at the same path.

## UI changes (minimal)

- `/audits` — add "Open report" link on each run row when `report_html_path` is set; opens signed URL in a new tab.
- `/reviews` — same, on each review row.
- No new pages, no new routes.

## Observability

- New sentinel check `audit_report_render_failed` (medium, high ≥3 in 24h): rows where the function logged a render/upload error but the underlying run/review succeeded. Surfaces silent regressions in the renderer without blocking the primary pipeline.
- Render failure does not fail the parent run — the markdown/DB output is still the source of truth.

## Docs + memory

- `docs/deep-audit.md` and `docs/awip-reviews.md`: append a short "HTML report" section (≤15 lines each, respecting doc hygiene caps).
- New memory `mem/preferences/html-as-view.md`: "markdown is source of truth; HTML is a renderable view for audit + review reports only; do not propose converting docs/mem/plans/ADRs/CHANGELOG."
- `mem/index.md`: one-line entry under Memories.
- `CHANGELOG.md`: single line.

## Verification

- Unit test for `html-report.ts`: snapshot of a small fixture (escaping, SVG dimensions, link rendering).
- Manual: trigger one deep-audit and one awip-reviews-pull, open the resulting signed URL, visually QA in browser (one screenshot per kind under `/tmp/browser/`).
- Sentinel check tested with a forced render failure path.

## Technical notes

- Token cost: irrelevant here — these reports are written, not fed back into LLM context. No model calls in the renderer.
- Security: server-side HTML, no user input rendered as raw HTML; all interpolation goes through an `escapeHtml` helper. CSP not needed because the file is served via signed URL out of a private bucket and opened standalone.
- No new secrets.
