# Import 4 Hermes-agent patterns into AWIP

Four independent slices, shippable in order. Each gets its own migration + edge-function change + sentinel hook so partial rollout is safe.

---

## 1. Worker heartbeat / reclaim / zombie / auto-block

**Problem:** `roadmap_phase_overnight_runs` and night-eligible `discussion_actions` runs can die mid-flight (edge timeout, cold start, crash). We re-enter on the next 15-min cron and hope. No retry cap, no "exited without completing" signal.

**Schema (migration):**
- `roadmap_phase_overnight_runs`: add `heartbeat_at timestamptz`, `attempts int default 0`, `max_retries int default 3`, `last_error text`.
- New status values allowed: `'reclaimed'`, `'auto_blocked'`.
- `discussion_actions`: add `night_run_started_at`, `night_run_heartbeat_at`, `night_run_attempts int default 0`, `night_run_max_retries int default 3`, `night_run_last_error text`.
- New SQL function `public.reclaim_stale_night_jobs(_stale_minutes int default 10)` — flips `running` rows whose `heartbeat_at < now() - interval` back to `queued` and bumps `attempts`; if `attempts >= max_retries` flips to `auto_blocked` instead. Operator-only.

**Edge functions:**
- `overnight-phase-runner-15m`: on pickup, set `status='running'`, `started_at=now()`, `heartbeat_at=now()`, `attempts=attempts+1`. Heartbeat every ~30s during long work. On clean finish, status→`done`. On thrown error, write `last_error`, status→`queued` if `attempts<max_retries` else `auto_blocked`.
- `night-agent-open` / `night-agent-close`: same pattern on the discussion_actions side.
- `sentinel-tick`: new check `night_jobs_stalled` — counts rows with `status='running' AND heartbeat_at < now() - interval '10 min'`. Emits `sentinel_finding` (severity high) and calls `reclaim_stale_night_jobs()` itself so reclaim happens within 15 min even if the runner is down.

**UI:**
- `/master-plan` overnight card and `/morning-review` night audit row: show `attempts/max_retries` chip and red "auto-blocked" pill with `last_error` tooltip.

---

## 2. Post-write delta lint at the tool-call level

**Problem:** Companion edits (and any future agent edits) ship syntax errors that only surface in CI 2–10 min later. doc-drift / logger-coverage scripts run too late.

**Implementation:**
- New shared module `supabase/functions/_shared/delta-lint.ts` exposing `lintFiles(changes: {path: string; content: string}[])`. For each file:
  - `.ts` / `.tsx` → spawn `deno check --no-lock` against a tmp file (Deno is the runtime, free).
  - `.json` → `JSON.parse`.
  - `.md` / others → skip.
  Returns `{ok: boolean, errors: {path, message}[]}`.
- Wire into any edge function that produces file diffs back to the operator (currently `companion-cloud-chat` returns text only, so the immediate consumer is the next "agent that writes files" function). For now, expose as a callable `lint-delta` edge function so Companion can call it before claiming a fix.
- Add a `lint_delta_failures` 24h count to `edge_function_health()` view → surface on `/admin/edge-health`.

No DB changes needed beyond optional logging via existing `edge_request_logs`.

---

## 3. Companion session auto-resume across gateway restart

**Problem:** Companion drops chat state on edge cold-start. `companion_messages` exists but as audit trail, not source of truth.

**Schema (migration):**
- New table `public.companion_sessions`:
  - `id uuid pk`, `user_id uuid not null`, `title text`, `last_message_at timestamptz`, `created_at`, `updated_at`.
  - RLS: `user_id = auth.uid()` for all CRUD.
- `companion_messages`: add `session_id uuid references companion_sessions(id) on delete cascade`, index `(session_id, created_at)`. Backfill: create one session per existing user, attach all their messages.
- Realtime on `companion_messages` already exists; add `companion_sessions` to publication.

**Edge functions:**
- `companion-cloud-chat`: accept `session_id` in body (required for new requests, auto-create if missing). After streaming finishes (in `flush()`), insert user message + assistant message rows with `session_id`. Update `companion_sessions.last_message_at`.
- New `companion-session-load` GET endpoint: returns last N messages for `session_id` (operator JWT).

**UI:**
- `/companion`: on mount, read `?session=<id>` from URL or create a new session, fetch history via `companion-session-load`, hydrate chat. Persist `session_id` in URL so refresh preserves thread. Add session list dropdown (last 10 by `last_message_at`).

---

## 4. Default-deny allowlists + redaction-on-by-default

**Problem:** Telegram + Companion + Rork accept anything from anyone holding the service token / a logged-in JWT. Matches our `chat-first-policy-requests` memory but currently aspirational.

**Schema (migration):**
- New table `public.platform_allowlist`:
  - `id`, `platform text check (platform in ('telegram','rork','companion_web'))`, `principal text` (chat_id / user_id / email), `note text`, `created_by uuid`, `created_at`.
  - Unique `(platform, principal)`.
  - RLS: operator/admin only.
- New table `public.platform_allowlist_audit` for grant/revoke events (insert via trigger).
- Seed: insert your own Telegram chat_id + email so you don't lock yourself out on deploy.

**Helper SQL function:** `public.is_principal_allowed(_platform text, _principal text) returns boolean` — `security definer`, returns true if row exists.

**Edge functions:**
- `telegram-webhook`: before any processing, call `is_principal_allowed('telegram', chat_id::text)`. If false → log to `edge_request_logs` with `classified_error='allowlist_reject'` and return 200 (silent drop). No reply.
- `companion-cloud-chat`: after JWT validation, call `is_principal_allowed('companion_web', user.email)`. If false → 403 `{error:'not_allowlisted'}`.
- `gemini-tts` (Rork path): same check on the bearer principal.
- Default-on redaction: `_shared/logger.ts` already redacts; flip the env-driven opt-out (`LOGGER_REDACT=off`) to opt-out only — confirm by reading the file before edit.

**Sentinel:** new check `allowlist_rejects_24h` — if >50 rejects in 24h on any single platform, file high finding ("possible probing or stale config").

**UI:**
- `/admin` → new "Allowlist" panel: list rows per platform, add/remove with note. Operator-only.

---

## Sequencing

Ship in this order so each can soak overnight before the next lands:

1. **Day 1** — slice 1 (heartbeat). Highest leverage, lowest risk.
2. **Day 2** — slice 4 (allowlists). Pure additive, default-deny seeded with your own principals.
3. **Day 3** — slice 2 (delta-lint). Standalone edge function, no schema.
4. **Day 4** — slice 3 (session resume). Largest UI change; do last when the rest is stable.

## Out of scope (deliberately)

- `/goal` Ralph loop — duplicates existing focus surfaces.
- `no_agent` cron mode — cosmetic.
- Kanban dashboard — too large a paradigm shift for now.

## Memory updates

After each slice ships, append to `mem://features/` with a one-liner + reference, and update `mem://index.md` Memories list. No Core changes (the substrate principle still holds — these are reliability + safety, not new "who acts when" logic).
