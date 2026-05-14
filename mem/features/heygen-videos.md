---
name: HeyGen videos
description: HeyGen integration for quarterly recap + external pitch videos; free-plan tier (3/mo, ≤60s)
type: feature
---
- Table: `heygen_videos` (kind, title, script, status queued|processing|ready|failed, heygen_video_id, video_url, duration_s, error). Operator-only RLS, realtime on.
- View: `heygen_videos_month_count` (security_invoker) for free-plan quota chip.
- Edge functions: `heygen-create-video` (operator JWT, 3/mo soft-block, calls `POST /v2/video/generate`), `heygen-poll-video` (operator or service token, polls `v1/video_status.get`), `scheduled-heygen-poll` (cron `*/2 * * * *`, early-exits if no `processing` rows).
- Stock defaults: avatar `a9a39532d1834ee6aab8202d8deb9251` (Madison landscape), voice `9e832936642b4277b639f283915a77e6`. Swap via constants in `heygen-create-video/index.ts`.
- Quarterly recap script auto-synthesised via Lovable AI Gateway (`google/gemini-2.5-flash`) from latest `discussion_action` matching `%quarterly review%`.
- External pitch script lives in `AWIP_PITCH_SCRIPT` constant (also mirrored in `GenerateVideoDialog.tsx`).
- UI: `/admin/videos` operator-only page with quota chip, two generator cards, table of all videos with realtime, refresh-status button.
- Sentinel: `checkHeygenVideosFailed` — any `failed` row in last 24h → medium (≥2 → high); deduped daily.
- Secret: `HEYGEN_API_KEY`.
