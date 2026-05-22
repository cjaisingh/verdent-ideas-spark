
# Plan — Phase 5 s5.3 Milestone 4 (resolver close-out)

## Goal
Close Phase 5 sprint s5.3 by promoting the last `it.todo` (hard-revoke admin gating), executing the first real ADR-0004 acceptance bench and flipping the ADR from `proposed` → `accepted` with the matched branch, and shipping an operator-only `/entities/aliases` admin UI for revoke / merge / split that goes through existing `entity-resolve` endpoints.

## Non-goals
- Fact-side cascade mechanics (`canonical_facts.binding_status`, staged re-quarantine, KR grey-out) — Phase 6.
- Telegram routing for `alias_revoke_burst` — owed chat-first checklist first, separate task.
- Per-tenant descriptor-weight editing UI — Phase 6 onboarding.
- `resolve_truth()` wiring for resolver `conflict_open` events — W7.2 task already open.
- Bulk-conflict patterns (ADR-0005) — separate ADR bench, separate sprint.

## Blast radius & Core rule / ADR / FM-AI cited
- **Tables touched (read-only / no schema):** `tenant_node_aliases`, `tenant_nodes`, `entity_resolution_events`, `adr_bench_results`. **No new migration.**
- **Edge fn:** `entity-resolve` — no behaviour change in M4; only e2e tests against existing endpoints (`/aliases/revoke`, `/aliases/merge`, `/aliases/split`).
- **Surfaces:** new operator-only page `/entities/aliases`; sidebar entry under "Entities".
- **CI:** `e2e/resolver.test.ts` last `it.todo` promoted; needs `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` secrets in GH Actions.
- **Core rule defused:** `CONTEXT.md` rule #3 ("operator > AI on every entity, gated by `user_roles` + `has_role()`") — we're proving the admin-only path actually enforces 403 against operator-only JWTs.
- **ADR:** `docs/adr/0004-alias-revocation-cascade.md` § Acceptance — locks in the in-table vs BRIN vs MV branch based on measured p95.
- **FM-AI failure mode:** *unverified gating* (admin-only endpoints that nobody ever tested with a non-admin JWT, e.g. the entire pre-W7 surface). M4 closes the gap for the resolver's most destructive endpoint.

## Alternatives considered

1. **(Chosen) Three-user e2e fixture (anon / operator-only / operator+admin) + bench-then-ADR-flip + minimal admin UI.** One sprint, exercises real JWT→`has_role()` path, gives the ADR its decision data and unblocks Phase 6 fact-cascade with an actual operator surface to revoke from.
2. **Service-token shortcut for the success path** — use `x-awip-service-token` for the 200 branch, `operatorOnlyClient` for the 403 branch. Cheaper (no third user) but doesn't exercise the operator-JWT → `user_roles.admin` lookup at all, which is precisely the bug surface we're trying to cover. **Rejected.**
3. **Defer admin UI to Phase 6** — only ship the e2e + bench. Leaves the operator unable to revoke without `curl`, which means hard-revoke stays untested in anger and the ADR's `compliance_revocation_count_30d` trigger never fires. **Rejected** — pay the UI cost now (it's small: a table + 3 dialogs over existing endpoints).
4. **Materialised-view flip pre-emptively** instead of measuring. Premature; ADR explicitly demands measured trigger. **Rejected.**

## Contract (existing endpoints, no new agent loop)
No new edge function. M4 reuses:
- `POST /aliases/revoke { aliasId, hardRevoke?: boolean, reason: string }` → 403 `admin_required` when `hardRevoke && !isAdmin`; 400 `hard_revoke_reason_too_short` when `reason.length < 8`; emits `alias_revoke` or `alias_hard_revoke` event.
- `POST /aliases/merge`, `POST /aliases/split` — already operator-gated, surfaced in UI as-is.

Contract file `supabase/functions/_shared/contracts/retrieval-resolver.ts` already covers all three. No new contract needed.

## Persona sign-off (`docs/agents/team/`)
- **`compliance-auditor`** — "is there a `qa_check_events` / `entity_resolution_events` row for every state flip in this code path?" → yes, `entity-resolve` already emits `alias_revoke` / `alias_hard_revoke` events; UI uses the same endpoints, no new write path.
- **`event-engineer`** — "does every UI action go through the edge fn (not a direct table write)?" → yes, the admin page calls `supabase.functions.invoke('entity-resolve', ...)` only; no direct `from('tenant_node_aliases').update()`.
- **`tenant-manager`** — "can an operator from tenant A revoke an alias of tenant B from the UI?" → no; resolver already enforces tenant scoping on `aliasId` lookup; e2e adds `cross_tenant_revoke_returns_422` test.
- **`sentinel`** — "will the bench run produce a row in `adr_bench_results` so future drift is detectable?" → yes, `_shared.ts → uploadBenchResult()` already wired.
- **`control-plane-operator`** — "no routing logic in Core" → admin UI is a thin form; no scheduling, no fan-out.

## Gap checklist
- [x] Idempotency — revoke/merge/split already idempotent via aliasId + `revoked_at IS NOT NULL` short-circuit.
- [x] `*_events` emission — covered by existing handler.
- [x] RLS + `has_role()` — endpoint enforces `isAdmin = has_role(user_id, 'admin')`; e2e proves it.
- [x] Realtime — `entity_resolution_events` already in `supabase_realtime` publication; UI subscribes for the activity feed.
- [x] `observability_registry` — `alias_revoke_burst` already registered (M3).
- [x] `withLogger` — `entity-resolve` already wrapped.
- [ ] No new `any` — UI types from `supabase/types.ts` only; lint ratchet must not regress.
- [x] Mem rule — update `mem/features/entity-resolver.md` (add M4 line: admin-UI + bench result + ADR status).
- [x] CHANGELOG — one entry per the three deliverables.
- [x] Doc updates — `docs/adr/0004-alias-revocation-cascade.md` status flip + chosen-branch row; `docs/iso42001-gap-analysis.md` §1 row for resolver gains an `oversight: operator-approve` note (deferred to AIMS lane if scope tight — see Out of scope).

## Test plan

| Behaviour | Test | Pass criterion |
|---|---|---|
| Admin JWT can hard-revoke | `e2e/resolver.test.ts > alias_hard_revoke_requires_admin_role` (promoted from `it.todo`) | adminClient → 200 + event row with `kind='alias_hard_revoke'`; operatorOnlyClient → 403 `admin_required` |
| Reason length enforced | same test, second case | `reason.length=4` → 400 `hard_revoke_reason_too_short` |
| Cross-tenant block | new `e2e/resolver.test.ts > cross_tenant_revoke_returns_422` | operator from tenant A trying to revoke tenant B's alias → 422 |
| Soft revoke idempotent | new `e2e/resolver.test.ts > soft_revoke_idempotent` | second call returns 200 with `already_revoked: true`, no second event row |
| Bench writes row | bench script smoke-check in `scripts/adr-bench/adr-0004-revocation.ts` | last row in `adr_bench_results` for `adr_key='ADR-0004'` matches the in-process measurement; `tripped_triggers` non-null |
| Admin UI gates on role | `e2e-playwright/entities-aliases.spec.ts` (new) | operator-only login → /entities/aliases shows "Admin required" banner, revoke button disabled |

`tdd` discipline: write the four new `e2e/resolver.test.ts` cases (currently `it.todo` or absent) before touching `entity-resolve`. UI Playwright test before the page. ADR-0004 bench script already exists — only adds a `--write-decision` flag that updates the ADR markdown's status line.

## Validation gates

Run after each milestone slice; **all** must be green before "ready":

```
bun run lint:ratchet                       # no new no-explicit-any sites
bun run typecheck                          # tsc --noEmit
bun run logger:coverage                    # withLogger wrap check
bunx vitest run e2e/resolver.test.ts       # 4 new cases pass
bunx vitest run e2e/security-definer-gating.test.ts  # ensure has_role path unbroken
bun run adr-bench:0004                     # writes adr_bench_results row + JSON in bench-results/
bunx playwright test e2e-playwright/entities-aliases.spec.ts
bun run docs:check-drift                   # ADR status flip reflected
```

Manual ops gate:
- ADR-0004 file: `Status: accepted` and the chosen-branch row in §Acceptance has a `✓ matched` annotation.
- Latest `adr_bench_results` row for `ADR-0004` visible on `/admin/adr-bench`.
- `/entities/aliases` accessible to operator+admin in preview; revoke / hard-revoke / merge / split round-trip OK and creates events visible on `/admin/entity-resolution`.

`diagnose` skill if the bench p95 sits in the `15–40ms` band: do not flip to MV — add the BRIN index in the same migration and re-bench before deciding.

## Out of scope (footer — feeds `plan-footer-ingest`)

- Telegram routing for `alias_revoke_burst` — owed chat-first checklist; separate task.
- Fact-side cascade (`canonical_facts.binding_status`, staged re-quarantine, KR grey-out) — Phase 6.
- `resolve_truth()` wiring for resolver `conflict_open` events — W7.2 task already open.
- Per-tenant descriptor-weight editing UI — Phase 6 onboarding.
- Bulk-conflict pattern detection (ADR-0005) — separate sprint.
- AIMS oversight-matrix column on `docs/iso42001-gap-analysis.md` §1 — AIMS lane (gap #2 from yesterday's stub), not resolver work.
- ADR-0003 ancestry flip — gated on real ≥5k-node tenant tree, not on this sprint.
- E2E admin-fixture provisioning automation — for now operator manually creates `E2E_ADMIN_*` GH secret; bootstrap-admin script deferred.
