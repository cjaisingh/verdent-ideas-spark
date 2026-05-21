# Gap analysis checklist

Walk every box. Each unchecked box is either fixed in the plan or moved to "Out of scope" with a one-line justification.

## Data & writes

- [ ] All write endpoints accept `Idempotency-Key` (mandatory for `/okr/ingest`, `/events/ingest`; strongly recommended for any other mutation).
- [ ] Every mutation emits a row into the matching `*_events` table (or new event table created in the same migration).
- [ ] No FK to `auth.users` — use `profiles` or `user_id uuid` referenced by `auth.uid()`.
- [ ] No CHECK constraints with time-based expressions — use validation triggers.

## AuthZ & isolation

- [ ] RLS enabled on every new public table.
- [ ] Policies gated by `has_role(auth.uid(), 'admin'|'operator')` or explicit tenant scoping.
- [ ] No role stored on `profiles`/`users` — only `user_roles`.
- [ ] Cross-tenant access path verified (write a fixture, prove the deny).

## Edge functions

- [ ] Wrapped with `withLogger` from `_shared/logger.ts` (or carries `// @logger-exempt: <reason>`).
- [ ] Auth = operator JWT or `x-awip-service-token` (cron via `AWIP_SERVICE_TOKEN`).
- [ ] Zod schema validates request body, returns 400 with field errors.
- [ ] Input contract declared in `_shared/contracts/<name>.ts` if cron/agent loop.
- [ ] CORS headers on every response, including error paths.

## Observability

- [ ] Entry in `observability_registry` for the new edge fn / cron / surface.
- [ ] Realtime publication added if UI consumes the table.
- [ ] Sentinel check named for the new failure mode (or explicit decision not to monitor).

## Docs & memory

- [ ] `CHANGELOG.md` `[Unreleased]` bullet drafted.
- [ ] Relevant `docs/*.md` updated (or new doc added under `docs/`).
- [ ] `mem/index.md` updated if a new always-on rule emerges.
- [ ] `scripts/check-doc-drift.ts` will stay clean (schema/edge fn ↔ docs in sync).

## Quality gates

- [ ] No new `any` types — `bun run lint:ratchet` will stay green.
- [ ] Tests named for every new behaviour (see `test-plan.md`).
- [ ] ADR drafted (proposed → accepted with bench numbers) if architectural.

## Output

Render the checklist into the plan as-is, with `[x]` for handled, `[ ]` for moved to Out-of-scope (each with a justification).
