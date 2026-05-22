# Runbook — 10-lane sequential sweep (2026-05-22)

Reference for operators inspecting the artefacts produced by the
session of 2026-05-22. Each lane lists the file(s) shipped, the
verification command, and the rollback step.

## Lane 1 — Telegram routing (verify-only)

- **Verified:** `alert_settings.operator_telegram_chat_id` is set
  (`7139482467`). `sentinel-tick` already routes `high`/`critical`
  findings through `dispatchAlert`, and `alerts.ts` fans to Telegram
  when the chat id is present. No code change.
- **Verify:** `select operator_telegram_chat_id from alert_settings;`
- **Rollback:** n/a.

## Lane 2 — AI policy memory

- **Files:** `mem/features/ai-policy.md`
- **Verify:** `cat mem/features/ai-policy.md` and confirm it appears
  under "Memories" in `mem/index.md` (link added below).
- **Rollback:** `rm mem/features/ai-policy.md`.

## Lane 3 — Human-oversight doc

- **Files:** `docs/human-oversight.md`
- **Verify:** open the doc; the surface table should cover Night Agent,
  overnight phases, capability promotion, tenant changes, alias
  revocation, decision authority, claim conflicts, lessons, budget.
- **Rollback:** `rm docs/human-oversight.md`.

## Lane 4 — Bootstrap-admin script

- **Files:** `scripts/bootstrap-admin.ts`
- **Verify (dry-run):**
  `bun run scripts/bootstrap-admin.ts ops@example.com --role operator`
  with an email that does NOT exist — expect "no auth user found".
- **Rollback:** `rm scripts/bootstrap-admin.ts`.

## Lane 5 — `resolve_truth()` wiring on tie branch (narrowed)

- **Files:** `supabase/functions/entity-resolve/index.ts` — on
  `conflict_open`, insert `claims` rows (one per conflicting candidate,
  `source='ai'`, `confidence=score`, `evidence_ref` with descriptors).
- **NOT shipped this session:** calling `public.resolve_truth()` from
  service context — the function is SECURITY DEFINER but checks
  `has_role(auth.uid(), ...)`, which fails for service-role callers.
  Resolution stays on the operator's `/governance` page.
- **Verify:**
  `select count(*) from claims where source='ai' and created_at > now() - interval '1 hour';`
  after a synthetic conflicting `/resolve` call.
- **Rollback:** revert the conflict-branch insert block in
  `entity-resolve/index.ts`.

## Lane 6 — `no-explicit-any` ratchet (deferred)

- **Status:** baseline freeze is already enforced by
  `bun run lint:ratchet`. Cleaning 30 files this session would balloon
  the change set and risk regressions; tracked as discussion_action.
- **Verify:** `bun run lint:ratchet` — should pass at total=517.
- **Action item:** schedule a dedicated session.

## Lane 7 — Stalled-cron sweep (deferred to edge fn)

- **Status:** sandbox cannot query the `cron` schema directly; the
  sweep must run as an edge function with the service role. Spec
  captured below, implementation deferred to next session.
- **Spec:** new edge fn `cron-sweep-stalled` (15-min cadence). Queries
  `cron.job_run_details` for jobs with no successful run in the past
  6× cadence; emits a `medium` finding per stalled job.

## Lane 8 — ADR-0004 bench polish

- **Status:** `scripts/adr-bench/adr-0004-revocation.ts` already
  records p50/p95/p99, alias row count, iterations, and trips
  thresholds at 15ms/40ms. No further polish required this session.
- **Verify:** `bun run scripts/adr-bench/adr-0004-revocation.ts`
  (requires SUPABASE_URL + SERVICE_ROLE).

## Lane 9 — Runbook

- **Files:** this document (`docs/runbooks/lane-deliverables-2026-05-22.md`).
- **Rollback:** `rm docs/runbooks/lane-deliverables-2026-05-22.md`.

## Lane 10 — Persona coverage script

- **Files:** `scripts/persona-coverage.ts`
- **Verify:** `bun run scripts/persona-coverage.ts | jq .status`
  — should print `"ok"` once every persona is referenced from
  `AGENTS.md` and `mem/preferences/verify-completion.md`.
- **Exit code:** 0 on `ok`, 1 on `drift`. Safe to wire into CI.

## Out of scope (carry-forward to next session)

- Lane 5: calling `resolve_truth()` from service context (requires
  `SECURITY DEFINER` variant that skips the role check, or an operator
  JWT path inside `entity-resolve`).
- Lane 6: actually shrinking the `no-explicit-any` baseline.
- Lane 7: implementing `cron-sweep-stalled` edge fn.
- ADR-0003 ancestry flip (corpus < 1k).
- Full `no-explicit-any` cleanup beyond 30-file slice.
- W7.3 / W7.4.
- Telegram routing beyond `alias_revoke_burst`.
- `/admin/adr-bench` historical backfill.
- Linear/issue mirroring.
