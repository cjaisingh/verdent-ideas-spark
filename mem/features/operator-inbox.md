---
name: Operator Inbox
description: Unified inbox (Telegram + manual paste) with operator/Caprica lane split, layered classifier, auto-promotion
type: feature
---

# Operator Inbox

Unified inbox for inbound operator signals. Surfaces: `/operator-inbox`,
Morning Review panel, sidebar entry.

## Sources & lanes
- `operator_inbox_sources` registry — `chat_id`, `kind` (`dm`/`group`/`channel`),
  `label`, `enabled`, `lane` (`operator` | `caprica`), `notes`.
- `telegram-webhook` ingests only registered + `enabled=true` chats that also
  pass `is_principal_allowed`. Anything else → `__classified_error=
  inbox_source_unregistered` in `edge_request_logs`.
- `operator_messages.lane` mirrors source lane.

## Classifier (`_shared/classifyInboxKind.ts`)
1. Prefix rules (zero cost): `/idea`, `#research`, `/suggest`, `/ask`, `/chat`,
   `idea:`, `research:`, `suggestion:`, trailing `?` → `question`.
2. `google/gemini-2.5-flash-lite` fallback if text ≥ 12 chars. Logged in
   `ai_usage_log` as `route-operator-message:inbox-kind`.
3. Manual override in `/operator-inbox` → `kind_source='manual'`.

## Auto-promotion
`route-operator-message` creates a `discussion_actions` row for
`kind ∈ {idea, research, suggestion}` when `promoted_action_id IS NULL`.
Idempotent via unique `(subject_type, subject_id)`. Defaults: priority=normal,
risk=low, source=`operator_inbox`.

## Known gap
Image-only messages have no text/vision pipeline — `raw->'message'->'photo'`
file_ids sit unused, UI renders empty body. Vision branch deferred.

## Views & sentinels
Views: `v_operator_inbox_24h` (operator lane), `v_caprica_inbox_24h`,
`v_operator_inbox_unpromoted`. Sentinels: `inbox_kind_classify_failures`
(medium, >10% LLM errors/24h), `inbox_source_silent` (low, 14d idle source).
