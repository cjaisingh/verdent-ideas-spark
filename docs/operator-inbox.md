# Operator Inbox

Unified inbox for inbound operator signals (Telegram DMs, groups, channels, manual paste).

## Sources

Allowed Telegram chats are gated by `public.operator_inbox_sources` (operator-only RLS).
Each row: `chat_id`, `kind` (`dm` / `group` / `channel`), `label`, `enabled`, `notes`.

`telegram-webhook` ingests only messages whose `chat.id` is registered with `enabled = true`.
Anything else is silently dropped with `__classified_error = 'inbox_source_unregistered'`
in `edge_request_logs` so the platform allowlist still records the rejection.

The "Lovable product channel" is **not** ingestable via Bot API unless the bot is added
as a member/admin. Long tail: paste via the inbox composer (writes a row with
`source = 'manual_paste'`).

## Classification (layered)

`supabase/functions/_shared/classifyInboxKind.ts`:

1. **Prefix rules** (zero cost, deterministic): `/idea`, `#research`, `/suggest`, `/ask`,
   `/chat`, `idea:`, `research:`, `suggestion:`. Trailing `?` → `question` (0.8 conf).
2. **LLM fallback** (`google/gemini-2.5-flash-lite` via Lovable AI Gateway, tool-calling),
   only if text ≥ 12 chars. Cost is logged in `ai_usage_log`
   with `job = 'route-operator-message:inbox-kind'`.
3. **Manual override** — operator can re-tag any row via `/operator-inbox`, which writes
   `kind_source = 'manual'`.

Kinds: `idea`, `research`, `suggestion`, `question`, `chat`.

## Auto-promotion

`route-operator-message` auto-creates a `discussion_actions` row when:

- `kind ∈ {idea, research, suggestion}` AND
- `promoted_action_id IS NULL`

Insert is idempotent via the unique `(subject_type, subject_id)` index. Defaults:
`priority = 'normal'`, `risk = 'low'`, `source = 'operator_inbox'`.
`operator_messages.promoted_action_id` is then set so the UI shows a "promoted" chip.

## Surfaces

- `/operator-inbox` — full table, filters, KPI strip, manual-paste composer, realtime.
- Morning Review → "Operator inbox (24h)" panel (top 10).
- Sidebar → Operator → Operator inbox.

## Sentinel checks

- `inbox_kind_classify_failures` (medium) — >10% LLM classify errors in 24h
  (min 10 attempts). Dedupe per day.
- `inbox_source_silent` (low) — enabled source with zero messages in 14d.
  Dedupe per source per day.

## Views

- `v_operator_inbox_24h` — last 24h, joined to `operator_inbox_sources` for label.
- `v_operator_inbox_unpromoted` — actionable kinds with `promoted_action_id IS NULL`.
