---
name: awip-core-rules
description: Recap the five non-negotiable AWIP Core rules before any change to the contract API, database schema, or event streams. Load this skill whenever a task touches `awip-api`, `supabase/migrations/`, `okr_*`, `capability_*`, or `idempotency_keys`.
---

# Skill: awip-core-rules

Before you write or edit code that touches Core's contract surface, walk through this checklist out loud. If any answer is "no" or "unclear", stop and ask the operator.

## The five rules (verbatim from CONTEXT.md)

1. **Every OKR mutation emits an `okr_node_events` row.**
2. **Every manifest change emits a `capability_events` row.**
3. **All write endpoints are idempotent** via `Idempotency-Key` + body hash.
4. **No "who acts when" routing logic in Core.**
5. **Never edit `src/integrations/supabase/types.ts` directly** — migrations only.

## Pre-flight checklist

For the change you are about to make, answer:

- [ ] Does this insert/update/delete an OKR node? → Confirm the same code path inserts into `okr_node_events`. If using a trigger, name it.
- [ ] Does this register a capability or change its status/version/owner? → Confirm the same path inserts into `capability_events`.
- [ ] Is this a write endpoint on `awip-api`? → Confirm `Idempotency-Key` is required, body hash is computed, and the cached response path is wired.
- [ ] Does this introduce branching on capability id, KR id, or tenant to choose an action? → If yes, this routing belongs in Control Plane or the acting module, not Core. Push back.
- [ ] Are you about to edit `src/integrations/supabase/types.ts`, `client.ts`, or `.env`? → Stop. Write a migration instead.

## Secondary invariants to re-check

- New edge function? Wrap with `withLogger` from `_shared/logger.ts`.
- New table? RLS enabled, policies defined via `has_role()`, never expose to anon unless explicitly public.
- New cron job? Auth with `AWIP_SERVICE_TOKEN`, register in `docs/automation.md`.
- New write endpoint? Add an entry to `docs/api.md` and an e2e test in `e2e/edge-function.test.ts`.

## If a rule must be broken

It can't. The rules are what make AWIP composable. If the request seems to require breaking one, the request is wrong — surface the conflict and propose an alternative that keeps the invariants.
