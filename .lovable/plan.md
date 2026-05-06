
# AWIP Voice-Loop — Phase A

Build the Telegram bridge, the four operator tables, and the seed policy data inside this Lovable project (AWIP Core). Phases B–E follow in subsequent messages, one at a time, so each is independently reviewable and revertable.

## What gets built in Phase A

### 1. Connect Telegram

Trigger the Telegram connector picker against this project so `TELEGRAM_API_KEY` and `LOVABLE_API_KEY` are available to edge functions.

### 2. Database (one migration)

Four new tables, all RLS-locked to operators only (matches existing pattern).

```text
operator_messages
─────────────────
id                uuid pk
update_id         bigint unique         -- Telegram update_id, idempotency
chat_id           bigint
direction         text                  -- 'inbound' | 'outbound'
text              text
intent            text                  -- parsed by router; null until classified
raw               jsonb
created_at        timestamptz

approval_queue
──────────────
id                uuid pk
activity          text                  -- e.g. 'gmail.send'
intent_payload    jsonb                 -- what would be executed if approved
risk              text                  -- 'safe' | 'risky' | 'unknown' | 'blocker'
status            text                  -- 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed'
telegram_message_id bigint              -- the message with inline buttons
requested_by      text
decided_by        text
decided_at        timestamptz
result            jsonb
created_at        timestamptz

rethink_tasks
─────────────
id                uuid pk
topic             text
original_proposal jsonb
reason            text                  -- why first answer was unconvincing / blocker
temp_fix          text                  -- optional, for blockers
status            text                  -- 'open' | 'in_review' | 'resolved'
created_at        timestamptz
resolved_at       timestamptz

activity_policies
─────────────────
id                uuid pk
activity          text unique           -- 'gmail.send', 'gmail.draft', 'calendar.hold', ...
default_action    text                  -- 'auto' | 'approve' | 'block'
conditions        jsonb                 -- IF/THEN rule list, first match wins
notes             text
updated_at        timestamptz
```

Seed `activity_policies` conservatively:

```text
gmail.read                 auto
gmail.draft                auto
gmail.send                 approve
calendar.read              auto
calendar.hold (own cal)    auto
calendar.invite_external   approve
drive.read                 auto
drive.write                approve
awip.spawn_okr             approve
awip.supersede_okr         approve
```

### 3. Edge function: `telegram-webhook`

- `verify_jwt = false` (added to `supabase/config.toml`)
- Validates `X-Telegram-Bot-Api-Secret-Token` against base64url-SHA256 of `telegram-webhook:${TELEGRAM_API_KEY}` (constant-time compare)
- Inserts inbound update into `operator_messages` (upsert on `update_id` for idempotency)
- Handles `callback_query` from inline buttons → updates `approval_queue.status` to `approved` / `rejected`, records `decided_by`, `decided_at`
- Returns `{ ok: true }` quickly; heavy work deferred to Phase B router

### 4. Edge function: `telegram-send` (helper)

Small internal-only helper used by later phases to post messages and inline-button approval prompts via the gateway. Service-token-protected, not exposed to end users.

### 5. Register the webhook

After deploy, call `setWebhook` through the connector gateway with:

```text
url           = https://<ref>.supabase.co/functions/v1/telegram-webhook
secret_token  = base64url(sha256("telegram-webhook:" + TELEGRAM_API_KEY))
allowed_updates = ["message","edited_message","callback_query"]
```

Verify with `getWebhookInfo`.

### 6. Smoke test

Send a Telegram message to the bot → confirm a row lands in `operator_messages`. Tap a fake inline button via `telegram-send` → confirm `approval_queue` row flips status. No reasoning yet (that's Phase B).

## Files

- create migration: tables `operator_messages`, `approval_queue`, `rethink_tasks`, `activity_policies` + RLS + seed inserts for `activity_policies`
- create: `supabase/functions/telegram-webhook/index.ts`
- create: `supabase/functions/telegram-send/index.ts`
- edit: `supabase/config.toml` — add `[functions.telegram-webhook] verify_jwt = false`
- run: `standard_connectors--connect telegram`, then `setWebhook` via gateway curl

## Out of scope for Phase A

- The 4 `/awip/*` primitives (Phase C)
- The reasoning router with model-map (Phase B)
- Gmail / Calendar connectors (Phase D)
- `/policies`, `/approvals`, `/rethink` operator UI pages (Phase E)
- Gemini Gem configuration on your phone (external, not a Lovable change)

## After Phase A

You'll be able to message the bot and have it logged + acknowledged, and the approval-queue mechanics will be testable end-to-end with synthetic rows. Phase B adds the brain.
