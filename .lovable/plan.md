
# Plan: Operator Inbox for Telegram requests & suggestions

## Goal

Every Telegram message you send AWIP — DMs, group chats, broadcast channels — lands in one inbox, gets tagged as `idea` / `research` / `suggestion` / `question` / `chat`, and the actionable ones auto-promote to `discussion_actions` so they flow through the same triage as everything else.

## Current state (verified)

- `operator_messages` already captures inbound DMs (14 rows; chat_id `7139482467`) via `telegram-webhook` → `route-operator-message` → LLM-classifies into `intent` (`smalltalk` / `query_status` / etc.) — *automation* intent, not *inbox kind*.
- No UI surfaces these messages anywhere today.
- `platform_allowlist` already gates ingestion per `chat_id`.
- Bot API constraint: AWIP can only read from channels/groups where it is a **member** (groups) or **admin** (broadcast channels) and `allowed_updates` includes `channel_post`. Public Lovable channels you don't control aren't reachable via Bot API — covered in §6.

## 1. Schema

Migration adds:

- `operator_messages` columns:
  - `source text not null default 'dm'` — `dm | group | channel | manual_paste`
  - `kind text` — `idea | research | suggestion | question | chat | null`
  - `kind_source text` — `prefix | llm | manual | null`
  - `kind_confidence numeric`
  - `promoted_action_id uuid references discussion_actions(id)`
  - index `(created_at desc)` already exists; add partial `where promoted_action_id is null and kind in ('idea','research','suggestion')` for the "needs action" filter.
- New table `operator_inbox_sources` (operator-only RLS):
  - `chat_id bigint pk`, `kind text` (`dm|group|channel`), `label text`, `enabled bool default true`, `notes text`, `created_at`.
  - Seed row for the existing DM (`7139482467 / 'Operator DM'`).
  - Acts as the registry of *which* Telegram conversations are valid sources (independent of `platform_allowlist`, which is security; this is curation + labelling).
- View `v_operator_inbox_24h` — last 24h joined with source label, kind chip, action link.
- View `v_operator_inbox_unpromoted` — `kind in ('idea','research','suggestion')` and `promoted_action_id is null`.

## 2. Ingestion (telegram-webhook)

- Add `channel_post` + `edited_channel_post` to webhook handling — same upsert into `operator_messages`, set `source` from chat type (`private→dm`, `group/supergroup→group`, `channel→channel`).
- Tighten gate: must pass **both** `platform_allowlist` (security) **and** be present in `operator_inbox_sources` with `enabled=true` (curation). Silent-drop with `__classified_error='inbox_source_unregistered'` so it shows in sentinel if a new chat tries to talk to the bot.
- Re-register webhook with `allowed_updates: ["message","edited_message","channel_post","edited_channel_post","callback_query"]` (one-shot bash via gateway).

## 3. Layered classification (`_shared/classifyInboxKind.ts`)

New shared module returns `{ kind, source: 'prefix'|'llm', confidence }`.

1. **Prefix rules (deterministic, zero cost)** — first non-empty hit wins, case-insensitive:
   - `/idea`, `#idea`, `idea:` → `idea`
   - `/research`, `#research` → `research`
   - `/suggest`, `#suggest`, `#suggestion`, `suggestion:` → `suggestion`
   - `/ask`, `?` at end → `question`
   - `/chat` → `chat`
2. **LLM fallback** — only if no prefix matched, and message length ≥ 12 chars. Uses `gemini-2.5-flash-lite` (cheap; night-window policy already forces this anyway) with a small tool returning `{kind, summary, confidence}`. Logged to `ai_usage_log` as `route-operator-message:inbox-kind`.
3. **Manual override** — UI writes `kind` + `kind_source='manual'` directly. Never overwritten by re-classification.

Wired into `route-operator-message` *after* the existing activity classifier — both run, both persist their own columns. Inbox classify is also called for callback_queries skipping/ignoring (kind stays null).

## 4. Auto-promote to `discussion_actions`

In `route-operator-message`, when `kind ∈ {idea, research, suggestion}` and `promoted_action_id is null`:

- Idempotent insert into `discussion_actions`:
  - `title = first 80 chars of text`
  - `details = full text + transcript hint + source label`
  - `priority = 'normal'` (always — operator triages later; never auto-high)
  - `status = 'triage'`
  - `risk = 'low'` default (user can elevate; high/critical require explicit ops; this avoids the night-eligibility trap)
  - `source = 'operator_inbox'`, `source_ref = operator_messages.id`
- Find-or-create via `source_ref` to keep re-runs idempotent.
- Write back `operator_messages.promoted_action_id`.
- Manual re-tag → if a user changes kind back to `chat`/`question`, we don't auto-unpromote; we leave a note on the action and let them close it.

## 5. UI

### 5.1 `/operator-inbox` (new page + sidebar entry under "Operator")

- KPI strip: last-24h counts per kind, plus "unpromoted ideas/research/suggestions" pill.
- Filters: source (chip group from `operator_inbox_sources`), kind (chip group), `unpromoted only` toggle, search.
- Table rows: When · Source label · From (telegram username) · Text/transcript (truncated, expand-on-click) · Kind chip (editable dropdown — writes `kind` + `kind_source='manual'`) · Promoted action link (or "Promote now" button if eligible but unpromoted).
- Realtime: `supabase.channel('operator_inbox_stream_' + mountId)` on `operator_messages` (follows realtime channel naming rule).
- "Manual paste" composer at top — for content from sources Bot API can't reach (e.g. a Lovable Discord/Telegram channel you don't admin). Writes `source='manual_paste'`, runs through the same classifier + auto-promote pipeline.

### 5.2 Morning Review panel `operator-inbox-24h`

- Reuses existing panel framework (`src/components/morning-review/...`), shows up to 8 rows from `v_operator_inbox_24h` filtered to `kind in ('idea','research','suggestion','question')`.
- TriageChip works as on every other panel (Focus / Revisit / Done / Skip, sticky on slug).
- Row click → opens `/operator-inbox?message=<id>` deep link.

## 6. The "Lovable product channel" gap

Bot API has a hard ceiling: it can only ingest from chats the bot is a member of. Options, in order of preference:

- **A.** If it's a Telegram group/channel you control: add `@<awip-bot>` as member/admin and register it in `operator_inbox_sources`. Zero new code.
- **B.** If it's Lovable's public Telegram channel and you don't control it: Bot API won't deliver `channel_post` without the bot being added. Workarounds (out of this plan, flag for later): MTProto user-bot (Telethon/GramJS) running off-platform, or an RSS/relay bridge. **Plan ships option A only.**
- **C.** **Manual paste box on `/operator-inbox`** handles the long tail in the meantime.

## 7. Sentinel checks (additive, no schema change)

Two checks in `sentinel-tick`:

- `inbox_kind_classify_failures` — error rate of `route-operator-message:inbox-kind` in last 24h > 10% → medium.
- `inbox_source_silent` — any `operator_inbox_sources` row with `enabled=true` and no `operator_messages` in 14d → low (canary, easy to dismiss for low-traffic sources).

## 8. Docs + memory

- `docs/operator-inbox.md` — sources, classification layers, promotion rules, manual paste, the channel gap.
- README link, CHANGELOG entry.
- `mem://features/operator-inbox.md` summarising tables, classifier, auto-promote, page locations.
- Index update.

## Files (technical)

```text
supabase/migrations/<ts>_operator_inbox.sql      new
supabase/functions/_shared/classifyInboxKind.ts  new
supabase/functions/route-operator-message/index.ts  edit (call new classifier + auto-promote)
supabase/functions/telegram-webhook/index.ts        edit (channel_post + source resolution + registry gate)
supabase/functions/sentinel-tick/checks.ts          edit (2 checks)
src/pages/OperatorInbox.tsx                      new
src/components/morning-review/OperatorInboxPanel.tsx new
src/components/AppSidebar.tsx                    edit (sidebar entry)
src/App.tsx                                      edit (route)
src/pages/MorningReview.tsx                      edit (mount panel)
docs/operator-inbox.md                           new
README.md, CHANGELOG.md                          edit
mem/features/operator-inbox.md + mem/index.md    new + edit
```

## Out of scope (explicitly)

- Cross-platform inbox (Slack, Discord, email).
- Reading public Telegram channels via MTProto.
- Auto-priority/risk elevation — operator owns that on `discussion_actions`.
- Two-way reply from `/operator-inbox` back to Telegram (already covered by Companion + voice notes).

## Decision points before build

- Confirm seed of `operator_inbox_sources` only includes your DM (`7139482467 / 'Operator DM'`) — any group/channel chat_ids you want pre-seeded?
- Confirm prefix vocabulary above (`/idea`, `#research`, etc.) — happy with these, or different shorthand?
