---
name: Alert delivery to Telegram
description: dispatchAlert posts to alert_settings.webhook_url AND telegram-send when alert_settings.operator_telegram_chat_id is set; sentinel-tick fires daily heartbeat if no successful telegram-send in 25h.
type: feature
---

`alert_settings` row holds two independent sinks: `webhook_url` (Slack-style POST) and `operator_telegram_chat_id` (calls `telegram-send`). Both fire on every `dispatchAlert(...)` unless `enabled=false`, the per-reason flag is off, or dedupe window matches. Either sink succeeding marks the `alert_log` row delivered.

`credit_settings.operator_telegram_chat_id` is the same chat_id and powers the existing budget/runway path in `sentinel-tick`.

`platform_allowlist (telegram, '<chat_id>')` MUST be set or `telegram-webhook` drops inbound approvals from that chat.

Daily heartbeat in `sentinel-tick`: if chat_id configured but `edge_request_logs` shows no successful `telegram-send` in the prior 25h, sends a one-line ping. Catches silent regressions like the 5-day outage of 13–18 May 2026.

Lesson: an alerting pipeline that only writes to its own audit table is invisible. Every sink needs a heartbeat that exercises the actual transport.
