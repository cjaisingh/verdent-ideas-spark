## Goal
Make AWIP actually deliver every high-signal event into your Telegram (`@caprica_awip_bot`) so monitoring and approvals stop being silent.

## Root cause recap
Two empty settings rows kill all outbound:
- `alert_settings.webhook_url` is NULL → `dispatchAlert()` logs to `alert_log` but never posts.
- `credit_settings.operator_telegram_chat_id` is NULL → budget/runway path skips.
- `platform_allowlist` has no `telegram` principal → even if we send, inbound replies (approvals) would be dropped.

`telegram-send` itself works. `telegram-webhook` works. The pipes are healthy; nothing turns the taps on.

## Plan

### 1. Capture your chat_id
You message `@caprica_awip_bot` once (any text). I read it from `edge_request_logs` / `operator_messages` and use it everywhere below. **Blocker**: until this happens, none of the inserts below have a real value to point at.

### 2. Wire outbound (sentinel + morning review)
Replace the webhook-only `dispatchAlert` with a dual sink:
- Keep existing `alert_log` insert (audit trail).
- Add a Telegram leg that POSTs to `telegram-send` with `chat_id = alert_settings.operator_telegram_chat_id` for every `reason` whose flag is on.
- Add a new column `alert_settings.operator_telegram_chat_id` (bigint, nullable). Seed with captured chat_id.
- Keep webhook path optional — if `webhook_url` is set, both fire; if neither set, today's silent behaviour returns.

### 3. Wire inbound (approvals)
- Insert `(platform='telegram', principal='<chat_id>')` into `platform_allowlist`. This unblocks `telegram-webhook` so approvals/voice/text land in `operator_messages` and `approval_queue`.

### 4. Seed `credit_settings.operator_telegram_chat_id`
Same chat_id. Budget/runway alerts then fire through the existing `telegram-send` call already in `sentinel-tick`.

### 5. Add a self-test on `sentinel-tick` boot
Once per UTC day, if `operator_telegram_chat_id` is set but no successful `telegram-send` invocation in the last 25h, fire a one-line "alive" ping. Catches silent regressions like this one before they go 5 days.

### 6. Surface config in `/admin`
Add a tiny "Operator alert channel" card showing:
- Configured chat_id (or "not set" with link to send-test).
- Last successful `telegram-send` timestamp.
- Last `alert_log` row delivered/undelivered counts (7d).

So this never silently rots again.

## Technical notes
- Files touched: `supabase/functions/_shared/alerts.ts` (Telegram leg), `supabase/functions/sentinel-tick/index.ts` (daily heartbeat), one migration (`alert_settings.operator_telegram_chat_id`), one settings insert (chat_id + allowlist row), one `Admin.tsx` panel addition.
- No new edge function. Reuses `telegram-send` and existing `withLogger`/contract conventions.
- Dedupe still honoured via existing `alert_settings.dedupe_minutes`.

## What I need from you to start
Message `@caprica_awip_bot` (just type "ready") so step 1 has a chat_id. Then I run steps 2–6 as one migration + code patch.