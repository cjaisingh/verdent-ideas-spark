# Extract `operator_channel` module + approvals contract in Core

Honor the docs: Core stays substrate, Telegram/voice/Gem classification moves to a new `operator_channel` module, and approvals become a first-class contract on Core that any module can use.

## Why
Today Core hosts `operator_messages`, `approval_queue`, `activity_policies`, the Telegram webhook, and the router. That violates the "Core is substrate, not a brain" rule in `docs/architecture.md` and `docs/modules.md`. It also blocks future modules from requesting approvals through a stable contract.

## End-state architecture

```text
 Telegram ──► operator_channel module ──► Core /awip-api/approvals/request
                  │  (classify, voice ASR,                │
                  │   policy match, Telegram I/O)         ▼
                  │                              approval_queue (Core)
                  └──◄ Core /awip-api/approvals/:id/decide ──► capability_events
```

- **Core owns**: `approval_queue` (generic substrate), `/approvals/request`, `/approvals/:id/decide`, capability registry, events.
- **operator_channel module owns**: Telegram webhook + send, voice transcription, intent classification (Gemini), policy table, router. Registers capabilities `human_approval_gate`, `telegram_operator_channel`, `voice_intent_capture` with Core.

## Phase 1 — Core changes (substrate)

### Schema (migration)
1. Add to `approval_queue`:
   - `tenant_id uuid` (nullable for now; required once tenants exist per request)
   - `requesting_module text` (e.g. `operator_channel`)
   - `capability_id text` (FK-ish to `capabilities.id`, soft ref)
   - `callback_url text` nullable — module endpoint Core POSTs to on decision
   - `idempotency_key text` nullable + unique index `(requesting_module, idempotency_key)`
2. Drop `operator_messages` and `activity_policies` from Core (after Phase 2 cutover; keep during migration).
3. Keep `idempotency_keys` table; reuse for `/approvals/request`.

### `awip-api` endpoints (service-token auth)
- `POST /approvals/request` — body: `{capability_id, activity, risk, intent_payload, requesting_module, callback_url?, idempotency_key?, requested_by?, tenant_id?}`. Validates `capability_id` exists in registry. Inserts pending row. Returns `{approval_id, status}`.
- `POST /approvals/:id/decide` — body: `{decision: 'approved'|'rejected', decided_by, result?}`. Updates row, emits `capability_events` row (`event_type='approval_decided'`), fires `callback_url` POST if set (fire-and-forget, logged).
- `GET /approvals/:id` and `GET /approvals?status=pending&module=...` — for module/UI polling.

### UI (Control Plane stays in Core for now)
- `/approvals` and `/approvals/:id` keep working — read directly from `approval_queue` via RLS as today. No UI rewrite this phase.
- The decision buttons in UI call `/approvals/:id/decide` instead of writing the row directly. This proves the contract from the inside.

## Phase 2 — Spin up `operator_channel` module project

A new Lovable project (separate Supabase). Uses the scaffold in `docs/module-scaffold/`.

### Tables (in module DB)
- `operator_messages` — full schema from Core + new columns:
  - `modality text` (`text` | `voice`)
  - `transcript text` nullable
  - `audio_file_id text` nullable
  - `tenant_id uuid` nullable
- `activity_policies` — same shape, plus `capability_id text` linking to a Core-registered capability id (soft ref via `GET /capabilities`).

### Edge functions (module)
- `telegram-webhook` — moved from Core. Adds voice path: detects `message.voice`, calls `getFile`, downloads OGG via gateway, transcribes with Gemini 2.5 Flash (audio input), stores `transcript`, then routes.
- `telegram-send` — moved from Core.
- `route-operator-message` — moved from Core. After classify + policy, instead of inserting locally, calls Core `POST /approvals/request` with `requesting_module='operator_channel'`, `callback_url=<module>/approval-callback`, `capability_id` resolved from policy row.
- `approval-callback` — receives Core's decision webhook, sends Telegram confirmation back to the originating chat.
- `register` — registers `human_approval_gate`, `telegram_operator_channel`, `voice_intent_capture` per the scaffold.

### Secrets (module project)
`AWIP_CORE_URL`, `AWIP_SERVICE_TOKEN`, `LOVABLE_API_KEY`, `TELEGRAM_API_KEY`.

## Phase 3 — Cutover & cleanup
1. Point Telegram `setWebhook` at the module's URL.
2. Verify a round-trip: Telegram message → module classify → Core `/approvals/request` → UI shows pending → operator decides in UI → Core POSTs callback → module replies on Telegram.
3. Drop `operator_messages`, `activity_policies`, `route-operator-message`, `telegram-*` from Core.
4. Update `docs/modules.md` to mark `operator_channel` as a real module with its three capabilities.

## Phase 4 — Voice (lands inside the module, not Core)
Gemini 2.5 Flash transcription inside the module's `telegram-webhook`. No new vendor, no new key. Deepgram fallback deferred behind a feature flag if quality is insufficient.

## Out of scope this round
- Multi-tenant enforcement on `tenant_id` (column added, validation later).
- Moving Control Plane UI out of Core (still embedded; separate project later).
- Browser dictation for `/control-plane` (only Telegram voice for now).

## Order of work
1. Core migration: extend `approval_queue`, add idempotency support.
2. Add `/approvals/request`, `/approvals/:id/decide`, `GET /approvals*` to `awip-api` + tests.
3. Switch existing UI decision flow to call the new endpoints (proves the contract).
4. Stand up `operator_channel` module project from scaffold; move Telegram + router + policies; add voice path.
5. Register module capabilities with Core; flip Telegram webhook; smoke test.
6. Delete moved tables/functions from Core; update docs.

## Risks
- **Two deploys to coordinate** during cutover — mitigate by running both webhooks briefly and disabling Core's once module is verified.
- **Capability id drift** between policy rows and registry — `register` is the source of truth; policies validated on write.
- **Callback delivery** — log every callback POST in `api_call_logs`; module is idempotent on `approval_id`.
