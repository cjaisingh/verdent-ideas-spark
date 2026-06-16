---
name: HTML as renderable view
description: HTML reports are an additional surface for Deep Audit + AWIP Reviews; markdown / DB rows stay source of truth
type: preference
---

# HTML as renderable view

Markdown is the system of record for `docs/**`, `mem/**`, plans, ADRs, runbooks, CHANGELOG. Do **not** propose converting any of those to HTML.

HTML is allowed only as a generated, read-only *view* of structured data already living in the database. Current uses:

- `deep_audit_runs.report_html_path` — written by `deep-audit` to `audit-reports/deep-audit/<run_id>.html`.
- `awip_reviews.report_html_path` — written by `awip-reviews-pull` to `audit-reports/awip-reviews/<review_id>.html`.

Renderer lives at `supabase/functions/_shared/html-report.ts`: pure string templating, inline CSS + SVG, all interpolation through `escapeHtml`, no JS, no external assets. Bucket `audit-reports` is private; UI mints a 5-min signed URL.

**Why:** review noise on PR diffs, token cost, grep-ability, and the entire ingestion + memory pipeline assumes markdown. The "all-in on HTML" pattern from Anthropic's Claude Code team doesn't fit a substrate where the operator stays in the loop on diffable rules.

**Do not** extend HTML output to plans, ADRs, ontology, runbooks, or any `docs/**` file without an explicit user decision.
