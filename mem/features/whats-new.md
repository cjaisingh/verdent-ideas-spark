---
name: What's New
description: /whats-new auto-drafted change journal — AI proposes drafts every 30min, operator approves; replaces in-chat post-change walkthroughs
type: feature
---
**Surface:** `/whats-new` (operator/admin only). Three tabs: Drafts, Published, Sources.

**Tables (operator+admin RLS, both in `supabase_realtime`):**
- `whats_new_entries` — title, area (schema|edge|ui|cron|policy|docs), four sections (what / why / how_to_use / impact), status (draft|published|dismissed), source_refs jsonb, model, shipped_at, published_at.
- `whats_new_sources` — idempotency ledger keyed `(kind, ref)` so the same migration/function/page/changelog/capability_event is never drafted twice.

**Pipeline:** `whats-new-draft` edge function (service-token via cron OR operator JWT for "Scan now"):
1. Pulls last 30 GitHub commits (via `GITHUB_REVIEWS_TOKEN`) → migrations, edge functions, pages.
2. Pulls last 24h of `capability_events`.
3. Pulls top 3 sections of CHANGELOG.md HEAD.
4. Filters out refs already in `whats_new_sources`. Caps at 8 drafts/run.
5. For each fresh source, calls Lovable AI Gateway with `pickModel('google/gemini-2.5-flash')` (night-cheap auto), `response_format: json_object`, strict 4-section schema. Logs to `ai_usage_log`.
6. Inserts entry as `draft`, links source.

**Cron:** `scheduled-whats-new-draft` every 30 min, AWIP_SERVICE_TOKEN auth.

**Sentinel:** `whats_new_drafts_stale` (medium) fires when > 20 unreviewed drafts OR oldest draft > 7 days. Day-bucketed dedupe.

**Operator actions per draft:** Publish (with optional inline edits), Save (just edits), Regenerate (deletes + re-scans), Dismiss. Published entries can be Unpublished back to draft.

**Why this exists:** the operator does NOT want chat-based post-change walkthroughs. All "what changed / why / how to use / impact" content lives in this one queryable surface instead.
