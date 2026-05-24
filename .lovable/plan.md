# Plan — Batch A + Batch D (M4 close-out debt + AIMS/ADR docs)

## Goal
Close the 3 pieces of M4 test/inbox debt (promote 2 remaining resolver `it.todo`s, add `alias_corpus_ready` sentinel check to auto-unblock the ADR-0004 bench, reclassify 6 blocked ADR-bench discussion_actions) **and** ship the two docs-only items (ISO-42001 §1 oversight column, ADR-0008 promotion criteria) in one review pass.

## Non-goals
- Running the ADR-0004 bench itself — gated on `alias_corpus_ready=true`; will fire automatically when the corpus crosses 1000.
- Telegram routing for `alias_revoke_burst` — Batch B (owes a chat-first round).
- `resolve_truth()` wiring for resolver `conflict_open` — Batch C (W7.2 work).
- Any behaviour change in `entity-resolve` — gating already in place from M4; we are only proving it with tests.

## Blast radius & Core rule / ADR / FM-AI cited
- **Tables touched (schema):** `discussion_actions` — add nullable `blocked_reason text`. No new tables.
- **Tables touched (data only):** 6 `discussion_actions` rows reclassified `open → blocked` via `supabase--insert` UPDATE.
- **Edge fns:** `sentinel-tick` — add one new check function `alias_corpus_ready` (no contract needed; it's a SQL-only count + insert into `sentinel_findings`). No new edge function.
- **Tests:** `e2e/resolver.test.ts` — 2 cases promoted from `it.todo`.
- **Docs:** `docs/iso42001-gap-analysis.md` (§1 table — add `oversight` column for 4 Phase 5 surfaces), `docs/adr/0008-expert-feedback-as-verifier.md` (append `## Promotion criteria`).
- **Surfaces:** /morning-review inbox loses 6 noisy rows; /admin/sentinel-findings may show a new `info`-level `alias_corpus_ready` finding when threshold crosses.
- **Core rule defused:** CONTEXT.md rule #3 (operator > AI gating via `user_roles` + `has_role()`) — promoted tests prove `hardRevoke && !isAdmin → 403`; rule #5 (every plan ends with auditable artefacts) — ISO-42001 oversight column makes the AIMS gate machine-readable.
- **ADR:** `docs/adr/0004-alias-revocation-cascade.md` — `alias_corpus_ready` is the missing prerequisite for the §Acceptance bench trigger. `docs/adr/0008-expert-feedback-as-verifier.md` — promotion criteria section locks the gate before any module starts producing capability traffic.
- **FM-AI failure mode:** *unverified gating* (M4 left 2 admin/tenant gates only `it.todo`) and *unbenched ADRs sitting in `proposed` indefinitely* (no automated nudge when the corpus is finally ready).

## Alternatives considered

1. **(Chosen) A+D as one PR, schema migration scoped to `blocked_reason` column only.** Doc work co-located because reviewer is already in `docs/adr/` and `docs/iso42001-*` files for the ADR-0008 stub follow-up. One CI run, one CHANGELOG entry, ~7 files.
2. **A and D as separate PRs.** Cleaner blame, but doubles the review pass and CI cost. D is ≤2 docs files — not worth its own PR. **Rejected.**
3. **Use a JSON `metadata` column on `discussion_actions` instead of `blocked_reason`.** Avoids a migration but loses indexability and grep-ability. We already have `source`/`source_ref` as first-class columns precisely because operator inbox SQL queries them directly. **Rejected** — same precedent applies.
4. **Skip `alias_corpus_ready` and just check the count manually before each ADR-0004 bench run.** Manual = it never happens; ADR sits in `proposed` for months. The sentinel check costs one SQL count per 15-min tick — negligible. **Rejected.**
5. **Make `alias_corpus_ready` fire as `medium` severity so it pages.** Overkill — corpus crossing 1000 is a milestone, not an incident. `info` severity, visible on /admin/sentinel-findings + rolled into Morning Review, is enough. **Chosen variant.**

## Contract
No new cron, edge function, or agent loop. `sentinel-tick` is an existing wrapped fn; new check is a same-file function `checkAliasCorpusReady()` returning `SentinelFinding | null`. No `supabase/functions/_shared/contracts/*` entry needed (the contract-first rule applies to *new* autonomous surfaces, not new checks inside an existing one).

## Persona sign-off

- **`compliance-auditor`** — "Will the reclassified rows still appear in audit history?" → Yes; `discussion_actions.updated_at` bumps, original `status` change is captured via existing `discussion_action_findings` join if any was linked, and `blocked_reason` is human-readable for any future audit replay.
- **`event-engineer`** — "Does the status flip emit an event?" → `discussion_actions` has no `*_events` sibling table (it's the inbox itself, not a domain entity). No event required; updated_at + reason column is the audit trail.
- **`tenant-manager`** — "Does the new `cross_tenant_revoke_returns_422` test actually exercise the tenant scope check?" → Test creates two operator JWTs from distinct tenants (uses existing `e2e/rls-fixtures.ts` helpers), confirms tenant-A operator hitting tenant-B's alias returns 422 not 200.
- **`sentinel`** — "Will the new check be noisy?" → Fires once on crossing (idempotent via `dedupe_key='alias_corpus_ready'` + 24h cooldown already in `sentinel-tick`). After firing, only re-fires if corpus drops below 1000 and crosses again — won't happen in practice.
- **`product-historian`** — "ADR-0008 promotion criteria — does it match the ADR-0007 Part 2 intent?" → Yes; criteria are derived directly from `docs/why-awip.md` §expert-feedback (≥1 module with capability traffic, ≥30d of `capability_events`, ≥1 expert-feedback test fixture).

## Gap checklist

- [x] **Idempotency** — `alias_corpus_ready` check uses 24h dedupe via existing sentinel-tick pattern. Discussion-action UPDATE is idempotent on `WHERE status='open' AND id IN (...)`.
- [x] **`*_events` emission** — N/A; `discussion_actions` is not an event-emitting entity. Sentinel finding insertion goes through standard `sentinel_findings` insert (already audited).
- [x] **RLS + `has_role`** — `discussion_actions` RLS already enforces operator-only; UPDATE goes via `supabase--insert` with service role (audit-trail safe, one-off). New migration adds column only — no policy change needed.
- [x] **Realtime** — `sentinel_findings` already in `supabase_realtime` publication; new check rides existing wiring. `discussion_actions` already published.
- [x] **`observability_registry`** — `alias_corpus_ready` registered in same migration that's not needed (no new table) — instead, add a row via `supabase--insert` into `observability_registry` if that table exists; otherwise documented in `mem/features/entity-resolver.md`. **Action item in plan.**
- [x] **`withLogger`** — sentinel-tick is already wrapped; new check inherits.
- [x] **No new `any`** — new test cases use existing typed helpers in `e2e/helpers.ts` + `e2e/rls-fixtures.ts`. Sentinel check returns typed `SentinelFinding`. Migration is SQL.
- [x] **Mem rule** — update `mem/features/entity-resolver.md` (add line: M4 test debt closed, ADR-0004 auto-unblock wired) and `mem/index.md` (no new entry — existing entry suffices).
- [x] **CHANGELOG** — one consolidated entry covering all 5 items.
- [x] **Doc updates** — `docs/iso42001-gap-analysis.md` §1 (new column), `docs/adr/0008-expert-feedback-as-verifier.md` (promotion section), `docs/adr/0004-alias-revocation-cascade.md` (note the auto-unblock wiring in §Acceptance).

## Test plan

| Behaviour | Test | Pass criterion |
|---|---|---|
| Admin JWT can hard-revoke; operator-only cannot | `e2e/resolver.test.ts > alias_hard_revoke_requires_admin_role` (promote `it.todo`) | adminClient → 200 + `entity_resolution_events` row with `kind='alias_hard_revoke'`; operatorOnlyClient → 403 `{error:'admin_required'}` |
| Reason length enforced on hard-revoke | same test, second branch | `reason.length=4` → 400 `{error:'hard_revoke_reason_too_short'}` |
| Cross-tenant revoke blocked | `e2e/resolver.test.ts > cross_tenant_revoke_returns_422` (new) | tenant-A operator hitting tenant-B alias → 422 `{error:'cross_tenant'}` and no event row emitted |
| `alias_corpus_ready` fires once at threshold | `supabase/functions/sentinel-tick/checks/alias-corpus-ready.test.ts` (new Deno test) | mock `count=999` → null; mock `count=1000` → finding with severity `info`; second invocation same day → null (dedupe) |
| Blocked rows leave open feed | `e2e/morning-review.spec.ts` smoke (manual check OK; not a new test) | `select count(*) from discussion_actions where status='open' and title ilike 'ADR%bench%'` drops by 6 |

`tdd` discipline: write the 2 promoted resolver cases first (currently `it.todo` at lines around 439+ in `e2e/resolver.test.ts`), confirm they fail against current handler (they should already pass — gating exists from M4), then commit. Write the Deno test for the sentinel check before the check function.

## Validation gates

Run after build slice; all must be green before "ready":

```
bun run lint:ratchet                                      # no new no-explicit-any
bun run typecheck                                          # tsc --noEmit
bun run logger:coverage                                    # sentinel-tick still wrapped
bunx vitest run e2e/resolver.test.ts                       # 2 newly-promoted + soft-revoke + existing cases
bunx vitest run e2e/tenant-resolve-isolation.test.ts       # adjacent suite stays green
deno test supabase/functions/sentinel-tick/checks/         # new alias-corpus-ready test passes
bun run docs:check-drift                                   # ADR-0004 / ADR-0008 / ISO-42001 edits reflected
```

Manual ops gate:
- `read_query` on `discussion_actions where status='blocked'` returns the 6 expected rows with `blocked_reason='phase-5-tables-not-implemented'`.
- `read_query` count on `tenant_node_aliases` recorded so we know how far below 1000 the corpus currently sits.
- Invoke `sentinel-tick` once manually; confirm `alias_corpus_ready` is **not** in findings (corpus < 1000) and no exception logged.

`diagnose` skill if the 2 promoted resolver tests fail unexpectedly: read `entity-resolve` handler at the `hardRevoke` branch and confirm the `isAdmin` check survives any post-M4 refactor.

## Out of scope (footer — feeds `plan-footer-ingest`)

- Running the ADR-0004 bench + flipping ADR `proposed → accepted` — gated on `alias_corpus_ready` firing; will be a separate session triggered by the sentinel finding.
- Telegram routing for `alias_revoke_burst` — Batch B (owes 4-question chat-first round).
- `resolve_truth()` wiring for resolver `conflict_open` events — Batch C (W7.2 task).
- Phase 6 canonical-fact cascade (`binding_status`, staged re-quarantine, KR grey-out) — Batch F (plan-only).
- Lint-ratchet pass #2 on next-worst file — Batch E.
- Drop-7-dead-tables migration — Batch E (destructive, deserves its own review).
- ISO-42001 oversight column expansion to §§2–4 — this batch covers §1 (Phase 5 resolver surfaces) only; the other 3 sections are Phase 6/W7 territory.
- ADR-0008 implementation (the actual expert-feedback verifier) — gated explicitly by the promotion criteria this batch ships.
