---
name: Out-of-scope auto-logger
description: plan-footer-ingest + session-summary-log fan "Out of scope" bullets into idempotent discussion_actions; out_of_scope_stale sentinel surfaces gaps after 14d
type: feature
---

Every plan with an "Out of scope" / "Not in scope" / "Deferred" / "Won't do" / "Won't ship" footer MUST be POSTed to `plan-footer-ingest` before claiming done. Session ends POST to `session-summary-log` with `out_of_scope: string[]`.

Both routes go through `supabase/functions/_shared/out-of-scope.ts → recordOutOfScope()` — never insert `discussion_actions.source in ('plan_footer','session_summary')` from anywhere else.

Idempotency: partial unique index `uniq_discussion_actions_autolog (source, source_ref, title)` — re-posts return `created_count: 0, skipped_count: N`.

`source_ref` shapes: `plan:<plan_id>` and `session:<session_summary_id>`. `subject_id` derived as deterministic UUIDv5 from `source_ref` so retries collapse.

Sentinel: `out_of_scope_stale` fires `medium` when any auto-logged row is `status='open'` for >14 days, grouped by `source_ref`. Lives in `sentinel-tick/checks.ts:1120`.

UI surface: Morning Review Discussion Actions panel + pane render "from plan" (amber) / "from session" (indigo) badges; `manual` rows show no source badge to cut noise. Filter toggle "Auto-logged only" on the panel header.

Out of scope for the autologger itself: historical plan backfill, editing UI for the source field, cross-project (Companion/Rork) ingestion paths.
