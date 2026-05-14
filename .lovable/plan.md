## /whats-new — operator-facing change journal

A new route that turns every shipped change (schema, edge functions, UI, cron, policy) into a short, structured entry. AI drafts; you approve before it's visible. No more verbose chat walkthroughs after the fact — they live in one queryable surface.

---

### 1. Data model (1 migration)

Two tables, operator-only RLS, both added to `supabase_realtime`.

`whats_new_entries`
- `id uuid pk`, `slug text unique` (e.g. `worker-heartbeat-reclaim`)
- `title text`, `area text` — enum-like: `schema | edge | ui | cron | policy | docs`
- `what text`, `why text`, `how_to_use text`, `impact text` — the four sections
- `source_refs jsonb` — `{ migrations:[], functions:[], pages:[], commits:[] }`
- `status text` — `draft | published | dismissed` (default `draft`)
- `shipped_at timestamptz`, `published_at timestamptz`, `created_by uuid`
- `model text`, `draft_meta jsonb` — for traceability when AI-drafted

`whats_new_sources` (idempotency ledger)
- `id uuid pk`, `kind text` (`migration|function|page|cron|policy|changelog`)
- `ref text unique-per-kind` — file path / function name / CHANGELOG hash
- `entry_id uuid null fk → whats_new_entries`
- `seen_at timestamptz`, `dismissed boolean default false`

Index on `(status, shipped_at desc)` for the feed.

### 2. Auto-draft pipeline

New edge function `whats-new-draft` (`withLogger`, service-token + operator JWT):

1. Scans recent rows in: `awip_migrations_seen` (existing), `capability_events` (last 24h), CHANGELOG.md HEAD diff via existing `GITHUB_REVIEWS_TOKEN`, `roadmap_phases` flipped to `done`, new files under `supabase/functions/*` and `src/pages/*`.
2. For each unseen `(kind, ref)` not already in `whats_new_sources` → calls Gemini (`pickModel('google/gemini-2.5-flash')`, so night-cheap automatically) with a strict JSON schema prompt → produces `{title, area, what, why, how_to_use, impact}`.
3. Inserts `whats_new_entries` row with `status='draft'`, links sources.

Cron: new `scheduled-whats-new-draft` every 30 min, plus a manual "Scan now" button on `/whats-new`.

### 3. UI: `/whats-new`

Single page, three tabs:
- **Drafts** — pending operator review. Inline edit fields, **Publish** / **Dismiss** / **Regenerate** buttons.
- **Published** — newest first, filter by `area`, search across all four sections.
- **Sources** — raw ledger, lets you mark a source `dismissed` so it won't redraft.

Entry card shows the four sections as labelled blocks (What / Why / How to use / Impact), with collapsible source refs at the bottom (links to migrations, function paths, pages).

Sidebar nav entry under "Operator", with a small `N` badge of pending drafts (realtime subscribed).

### 4. Integration with existing surfaces

- **Morning Review**: add a one-line strip "📣 N new entries published since yesterday" linking to `/whats-new?since=24h`. No duplication of content.
- **Sentinel**: new check `whats_new_drafts_stale` — fires `medium` if > 20 unreviewed drafts or oldest > 7 days. Keeps the queue honest.
- **Discussion actions**: "Promote to discussion" button on each draft if it needs follow-up.

### 5. Out of scope (intentional)

- No public-facing changelog page (operator-only for now).
- No email/push notifications (you'll see it in Morning Review).
- No retroactive backfill of pre-existing changes — only new shipments from migration date forward.
- No editing UI for the four-section template; it's fixed.

### 6. Files

```text
supabase/migrations/<ts>_whats_new.sql                   (new)
supabase/functions/whats-new-draft/index.ts              (new)
supabase/functions/sentinel-tick/checks.ts               (edit: add stale-draft check)
src/pages/WhatsNew.tsx                                   (new)
src/components/whats-new/EntryCard.tsx                   (new)
src/components/whats-new/DraftEditor.tsx                 (new)
src/components/AppSidebar.tsx                            (edit: nav + badge)
src/App.tsx                                              (edit: route)
src/pages/MorningReview.tsx                              (edit: 1-line strip)
docs/whats-new.md                                        (new — operator runbook)
README.md, CHANGELOG.md, AGENTS.md                       (edit)
mem/features/whats-new.md + index.md                     (new + edit)
```

Cron registered via `supabase--insert` (per house rule).

### 7. Sequencing

1. Migration + RLS + realtime.
2. Edge function + cron.
3. Page + sidebar.
4. Morning Review strip + sentinel check.
5. Docs + memory.

Ship as one slice — small enough that splitting adds churn.
