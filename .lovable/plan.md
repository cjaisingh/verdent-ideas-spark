### Why nothing's arriving

Webhook logs for the last 24h show only 3 hits — all from your operator DM. Zero rejected channel posts. So traffic from the two channels isn't even reaching the webhook. The most likely cause: `setWebhook` was registered with `allowed_updates: ["message","edited_message"]` only, so Telegram drops `channel_post`/`edited_channel_post` server-side before delivery. Bot being admin isn't enough — `allowed_updates` has to include those types.

### Steps

1. **Re-register the webhook** with expanded `allowed_updates`:
   - `message`, `edited_message`, `channel_post`, `edited_channel_post`, `callback_query`
   - Done via `telegram-webhook-reregister` (already exists, called by sentinel) — patch its `allowed_updates` payload.

2. **You post one short message** in each of the two chats (anything — "ping"). The webhook will reject them (not in `platform_allowlist`) but the reject path attaches `rejected_chat_id`, `chat_type`, `chat_title` to the log row. I'll read those out of `edge_request_logs.meta` to get the IDs.

3. **Insert rows** (one migration):
   - `platform_allowlist`: `(telegram, <lovable_chat_id>)`, `(telegram, <caprica_chat_id>)`
   - `operator_inbox_sources`: `(<lovable_chat_id>, channel/group, "Lovable feed", enabled, lane='operator')` and `(<caprica_chat_id>, ..., "Caprica feed", enabled, lane='caprica')`

4. **Verify**: post once more in each, confirm rows land in `operator_messages` with the right `lane`, and that the Caprica row does NOT auto-create a `discussion_action`.

### What I need from you next

- Approve this plan.
- After I patch the reregister payload, send "ping" (or any message) from inside each of the two chats. Reply "done" and I'll pull the IDs and finish the wiring.

### Technical notes

- Files touched: `supabase/functions/telegram-webhook-reregister/index.ts` (allowed_updates list), one new migration for the two allowlist + two inbox-source rows.
- No schema changes — `lane` already exists from the previous turn.
- If a chat is a **channel**, the bot must remain admin. If it's a **group/supergroup**, privacy mode must be off (BotFather → `/setprivacy` → Disable) so it sees non-command messages. Confirm before step 2 if unsure.
- Bot can't ingest from *another bot*. If `@caprica_awip_bot` posts into the Caprica chat as a bot, our bot only sees those messages if Telegram delivers `channel_post`s (it will, once allowed_updates is fixed) — bot-authored posts in channels arrive normally.
