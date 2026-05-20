---
name: Operator Inbox
description: Unified inbox (Telegram + manual paste) with operator/Caprica lane split, layered classifier, auto-promotion
type: feature
---

# Operator Inbox

Surfaces: `/operator-inbox`, Morning Review panel, sidebar.

## Sources & lanes
`operator_inbox_sources` (chat_id, kind dm/group/channel, label, enabled,
`lane` ∈ operator/caprica). `telegram-webhook` ingests only registered +
`enabled=true` chats that pass `is_principal_allowed`; rejects logged as
`__classified_error=inbox_source_unregistered`. `operator_messages.lane`
mirrors source lane.

## Classifier (`_shared/classifyInboxKind.ts`)
Prefix rules (`/idea`, `#research`, `/suggest`, `/ask`, `/chat`, trailing `?`)
→ `google/gemini-2.5-flash-lite` fallback (text ≥ 12 chars, logged as
`route-operator-message:inbox-kind`) → manual override (`kind_source=manual`).

## Auto-promotion
`route-operator-message` creates a `discussion_actions` row for
`kind ∈ {idea, research, suggestion}` when `promoted_action_id IS NULL`.
Idempotent via unique `(subject_type, subject_id)`. source=`operator_inbox`.

## Known gap
Image-only messages have no vision pipeline — `raw->'message'->'photo'` sits
unused, UI renders empty body. Vision branch deferred.

## Views & sentinels
`v_operator_inbox_24h` (operator lane), `v_caprica_inbox_24h`,
`v_operator_inbox_unpromoted`. Sentinels: `inbox_kind_classify_failures`
(>10% LLM errors/24h), `inbox_source_silent` (14d idle).
