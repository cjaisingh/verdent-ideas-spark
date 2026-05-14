## Goal

Add a thin HeyGen integration sized to the free plan (3 videos/month, ≤60s each). Ship two generators:

1. **Quarterly recap** — manual button on `/quarterly-review` (auto-trigger deferred).
2. **AWIP external pitch** — one-shot 60s explainer for sharing externally.

Both use HeyGen stock avatar + stock voice. All outputs land in a new operator-only `heygen_videos` table and a new `/admin/videos` page.

## Non-goals (this slice)

- Auto-trigger on `quarterly-review-open` (slice 2).
- Voice cloning, custom avatars, lip-sync, translation.
- Embedding videos on `/whats-new` or public pages.
- Quota enforcement beyond a soft client warning.

## Schema (1 migration)

`public.heygen_videos` — operator-only RLS, realtime on:

| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `kind` | text | `quarterly_recap` \| `external_pitch` (check constraint) |
| `title` | text | operator-supplied or auto |
| `script` | text | full prompt sent to HeyGen |
| `status` | text | `queued` \| `processing` \| `ready` \| `failed` (default `queued`) |
| `heygen_video_id` | text | from create response |
| `video_url` | text null | populated on `ready` |
| `thumbnail_url` | text null | |
| `duration_s` | numeric null | |
| `error` | text null | |
| `requested_by` | uuid | `auth.uid()` |
| `subject_kind` / `subject_ref` | text null | e.g. `discussion_action` + id for quarterly link-back |
| `created_at`, `updated_at` | timestamptz | trigger on update |

Plus monthly quota helper view `heygen_videos_month_count` (count where `created_at >= date_trunc('month', now())`).

## Edge functions (3 new, all `withLogger`-wrapped)

1. **`heygen-create-video`** (operator JWT)
   - Body: `{ kind, title, script, subject_kind?, subject_ref? }`
   - Validates Zod, checks monthly count < 3 (soft-block at 3), inserts row `status='queued'`, calls HeyGen `create_video_from_avatar` via REST (`HEYGEN_API_KEY` secret) with hard-coded stock avatar_id + voice_id (constants in file, easy to swap), updates row to `processing` + `heygen_video_id`. Returns row.
2. **`heygen-poll-video`** (operator JWT, also called by cron)
   - Polls all rows in `processing`, calls HeyGen `get_video`, updates `ready`/`failed` + URLs/duration. Idempotent.
3. **`scheduled-heygen-poll`** (service token, cron every 2 min while any row is `processing` — implemented as: cron always runs, function early-returns if no `processing` rows).

Cron via `supabase--insert` (not migration — contains anon key).

## Generators (server-rendered scripts, ≤900 chars ≈ 60s @ 150wpm)

- **Quarterly recap script builder**: pulls latest `quarterly-review` discussion_action, summarises via Lovable AI Gateway (`google/gemini-2.5-flash`) into a 60s narration. Lives in `heygen-create-video` when `kind='quarterly_recap'` and no `script` provided.
- **External pitch script**: hand-written constant in the function (`AWIP_PITCH_SCRIPT`), positioning AWIP Core as "operator console + capability registry — substrate, not a brain". Operator can override via `script` field.

## UI (2 surfaces)

**`/admin/videos`** (new page, operator-only, in admin nav):
- Header with monthly quota chip: `2 / 3 used this month` (red at 3).
- Two action buttons: **Generate quarterly recap** and **Generate external pitch** — each opens a small dialog with editable script preview, then POSTs to `heygen-create-video`.
- Table of all videos: kind, title, status badge, duration, created, video player on click (or open URL), retry button on `failed`.
- Realtime subscription on `heygen_videos` (unique channel name per mount).
- "Refresh status" button calls `heygen-poll-video`.

**`/quarterly-review`** (existing page):
- Add small "Generate recap video" button next to the latest quarterly action. Opens the same dialog, prefills `subject_kind='discussion_action'` + `subject_ref=<id>`. After ready, shows inline player + link to `/admin/videos`.

## Secrets

Need `HEYGEN_API_KEY` — will trigger `add_secret` after plan approval. No other new secrets.

## Sentinel

Add `heygen_videos_failed` check (medium): >0 `failed` in last 24h. Folded into existing 15-min `sentinel-tick`.

## Files

**Created (8):**
- `supabase/migrations/<ts>_heygen_videos.sql`
- `supabase/functions/heygen-create-video/index.ts`
- `supabase/functions/heygen-poll-video/index.ts`
- `supabase/functions/scheduled-heygen-poll/index.ts`
- `src/pages/AdminVideos.tsx`
- `src/components/heygen/GenerateVideoDialog.tsx`
- `mem/features/heygen-videos.md`
- `docs/heygen-integration.md`

**Edited (6):**
- `src/App.tsx` (route `/admin/videos`)
- `src/components/AdminNav.tsx` (or equivalent — link)
- `src/pages/QuarterlyReview.tsx` (recap button)
- `supabase/functions/sentinel-tick/checks.ts` + `index.ts` (new check)
- `mem/index.md` (add heygen-videos line)
- `CHANGELOG.md`

## Risks & open points

- HeyGen stock avatar_id + voice_id: I'll pick reasonable defaults from `list_avatar_looks` + `list_voices` after approval. You can swap them later via constants.
- Free plan also rate-limits API calls; I'll surface 4xx errors verbatim in `error` column.
- Quota check is best-effort (race-conditional); 3rd request in same minute could squeak through. Acceptable for a personal-use tool.
- Cron polls every 2 min, costs 0 HeyGen credits (read-only) but 1 edge invocation; we can stretch to 5 min if noisy.

## After approval

1. Apply migration.
2. Request `HEYGEN_API_KEY` secret.
3. Pick stock avatar + voice IDs.
4. Ship functions + UI.
5. You generate the quarterly recap and the pitch (2 of 3 monthly slots used) and we eyeball results.
