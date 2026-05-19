# AWIP Core — Agent Context

Non-negotiable rules. Any change to Core that violates one of these is wrong, regardless of how reasonable it looks in isolation. If a request appears to require breaking a rule, stop and surface the conflict — do not "just this once" it.

## Why AWIP exists

AWIP exists to prevent the four conditions that kill FM AI projects. Every architectural decision in Core defuses one of them — if a change doesn't, it probably doesn't belong here.

1. **Nobody understands the problem** — the OKR tree and capability manifest make explicit what is being solved, why it matters, and how progress is tracked. No vague pilots.
2. **The conditions have changed** — every OKR mutation is recorded with full event history. Priorities can be superseded without losing the trail. The system always reflects current reality.
3. **The cost outweighs the value** — the demand board surfaces which capabilities are actually used, which KRs drive them, and which are dead weight. Cost/value decisions become data-driven.
4. **The team has lost belief** — AWIP is designed to feel like a smart colleague, not a form to fill in. The assistant layer (Capica) exists specifically to maintain engagement and belief.

Full framing in [`docs/why-awip.md`](./docs/why-awip.md). Read it before the rules below — the rules only make sense once you understand the "why".

## The five rules

1. **Every OKR mutation emits an `okr_node_events` row.**
   Inserts, updates, supersessions, spawns — all of them. Consumers (Control Plane, Discovery AI, Morning Review) read the event stream, not the table. A silent write is a bug even if the table state is correct.

2. **Every manifest change emits a `capability_events` row.**
   Registration, status transitions (`planned → experimental → available → deprecated`), version bumps, owner changes. Same reason as rule 1: downstream modules subscribe to events.

3. **All write endpoints are idempotent.**
   Same `Idempotency-Key` header + same body hash → return the cached response and set `api_call_logs.idempotent_replay = true`. Same key + different body → `409 Conflict`. Never silently accept a second write under a reused key.

4. **No "who acts when" logic in Core.**
   Core records OKRs, capabilities, and events. Routing — which module handles which KR, when, with what budget — lives in Control Plane and the acting modules. If you find yourself adding `if (capability === 'x') doY()` to `awip-api`, stop.

5. **Never edit `src/integrations/supabase/types.ts` directly.**
   It is regenerated from the live schema. All schema changes go through migrations in `supabase/migrations/`. Same rule for `src/integrations/supabase/client.ts` and `.env`.

## Secondary invariants

- **Edge functions must be wrapped with `withLogger`** from `_shared/logger.ts`, or carry `// @logger-exempt: <reason>` at the top. The Logger Validation workflow enforces this.
- **Roles live in `user_roles`**, never on `profiles` or `auth.users`. Check via `has_role(auth.uid(), 'admin')` inside RLS — never from client storage.
- **Cross-project callers authenticate with `x-awip-service-token`**, validated against the `AWIP_SERVICE_TOKEN` secret. Never accept a write without either an operator JWT or this header.
- **Night window (22:00–06:00 UTC) forces cheap models** via `_shared/model-policy.ts → pickModel()`. TTS is exempt.
- **Realtime channels must have unique per-mount names** (`supabase.channel(\`foo-\${id}-\${useId()}\`)`). The sentinel watches for collisions.

## When in doubt

- Read `docs/architecture.md` and `docs/api.md` before adding endpoints.
- Read `docs/ontology.md` before introducing a new entity — there are 11 canonical ones and the list is locked.
- Read `docs/decision-authority.md` before changing who wins a truth conflict.
- Ambiguity → ask. Silent assumption → outage.

## Research & References

- [`docs/research/system-prompts-reference.md`](./docs/research/system-prompts-reference.md) — leaked system prompts from Cursor, Claude Code, Lovable, v0, Devin and others. Benchmark for AWIP's agent personas and Capica routing.
- [`docs/research/ebm-kona-reference.md`](./docs/research/ebm-kona-reference.md) — Kona 1.0 Energy-Based Model by Logical Intelligence. Candidate constraint-checker for Sentinel (OKR coherence, capability conflicts, gate satisfaction).

