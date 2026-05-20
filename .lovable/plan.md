## What's actually broken

The webhook code is fine. Two gates simply have only your DM registered:

- `platform_allowlist (platform='telegram')` — 1 row: `7139482467` (your DM).
- `operator_inbox_sources` — 1 row: same chat_id.

Anything from the Lovable or Caprica chats is silently dropped before it ever hits `operator_messages`. No bug; just unregistered sources. That's why yesterday "Lovable channel" and today "Caprica channel" were invisible.

Also worth flagging while we're here: `sentinel-tick` and `overnight-phase-runner-15m` have been throwing `auth_failed` (service-token mismatch) for ~24h — separate issue, not blocking this one, but I'll note it for a follow-up.

## Plan

### 1. Collect the two chat IDs (need from you)

I can't guess these. Easiest way:
- For each chat/channel, send any message to the bot from inside it, then I'll read `update.message.chat.id` from `edge_request_logs`. Or you paste the numeric chat IDs directly.
- For a Telegram **channel**, the bot must be an **admin** of the channel and `allowed_updates` must include `channel_post`. Confirm bot is admin in both.

### 2. Schema: add a "lane" to keep Caprica isolated

```text
operator_inbox_sources
  + lane text not null default 'operator'   -- 'operator' | 'caprica'
  + check (lane in ('operator','caprica'))
```

Views become lane-aware:
- `v_operator_inbox_24h` and `v_operator_inbox_unpromoted` filter `lane = 'operator'` (no behavioural change for existing rows — they default to `operator`).
- New `v_caprica_inbox_24h` mirrors the shape for the Caprica lane.

`route-operator-message` auto-promotion to `discussion_actions` only runs for `lane = 'operator'`. Caprica rows are captured and surfaced but don't pollute your action queue.

### 3. Register the new sources

Two `platform_allowlist` rows + two `operator_inbox_sources` rows (lane set appropriately, `kind = 'channel'` or `'group'` depending on what each one actually is):

```text
platform_allowlist:   (telegram, <lovable_chat_id>),   (telegram, <caprica_chat_id>)
operator_inbox_sources: (<lovable_chat_id>, ..., lane='operator'),
                        (<caprica_chat_id>, ..., lane='caprica')
```

Lovable channel → `operator` lane (you said treat it as first-class).
Caprica channel → `caprica` lane (isolated).

### 4. Webhook tweak

`telegram-webhook` needs one change: pass the source's `lane` through to `operator_messages` (new column `lane text not null default 'operator'`) and skip the auto-promotion call when `lane != 'operator'`.

### 5. UI surface (minimal)

- `/operator-inbox` gets a small "Lane" filter (defaults to Operator). Caprica tab shows the new view. No new page.

### 6. Verify

- You send a test message in each of the two chats.
- I confirm a row lands in `operator_messages` with the correct `lane` and that nothing is rejected with `__classified_error`.
- Stop there.

## Technical notes

- Migration is additive — no breaking change to existing inbox behaviour.
- `setWebhook` already includes `message` + `edited_message` + callback updates; I'll re-register with `channel_post`/`edited_channel_post` added so channel posts actually reach us (currently they'd arrive but only if the type is in `allowed_updates`).
- Telegram **groups**: the bot must have privacy mode off (via @BotFather → `/setprivacy` → Disable) to read non-command messages. I'll check `getBotInfo` once IDs are in.
- Files (.md docs): once a source is registered, `message.document` payloads will flow into `operator_messages.raw`. Optional follow-up: extract document text into `text` for inline display — out of scope for this fix.

## What I need from you to proceed

1. The two chat IDs (or just trigger one message in each so I can pull them from the log).
2. Confirm the bot is an admin in the Lovable & Caprica channels (or a member of the group with privacy mode disabled).
