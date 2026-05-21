
# Phase 5 — Entity & Tenant Resolution: kickoff

Open the first phase that gates a real domain module. Substrate (W7) and prep contracts are already in place; this plan turns the `retrieval-resolver.ts` contract + ADR-0003/0004 stubs into running code, sprint by sprint.

**Scope:** sprints **s5.1 → s5.2 → s5.3**. Each sprint ends with: migration + tests green, ADR moved from `proposed` → `accepted` with bench numbers, doc + memory update, sign-off via `roadmap_phases.phase_signoff` flow.

**Out of scope:** Phase 6 ingest pipeline, RAG split (ADR-0006 already accepted), any FM/domain table.

---

## Hard invariants (apply to every sprint)

- Resolver never crosses `tenant_id`. CI test with synthetic cross-tenant collision is the gate — fails the sprint if missing.
- Facts never bind to a guessed `tenant_node_id`. Confident → auto-bind + alias; ambiguous → `entity_resolution_conflicts`; no match → operator approval.
- Aliases are explicit, operator-approved, revocable. Fuzzy match proposes, never commits.
- Every mutation through `awip-api` carries `Idempotency-Key`; every approval emits a `capability_events` row.
- `resolve_truth()` owns winner selection — sprint code calls it, never reimplements precedence.

---

## s5.1 — Entity model + alias resolver

**Goal:** the table shape and the deterministic resolver path are live.

### Database (one migration)
- `tenant_nodes` (id, tenant_id, parent_id, kind, name, external_ids jsonb, status, superseded_by, timestamps). Operator-only RLS via `has_role()`. Realtime enabled.
- `tenant_node_aliases` (id, tenant_id, node_id, kind ∈ resolver descriptor enum, value, normalised, source, approved_by, approved_at, revoked_at). Unique `(tenant_id, kind, normalised) where revoked_at is null`.
- `entity_resolution_conflicts` (id, tenant_id, descriptors jsonb, candidates jsonb, status, resolved_by, resolved_at).
- `entity_resolution_events` (id, kind ∈ propose|bind|alias_create|conflict_open|conflict_resolve, payload jsonb, actor, request_id) — mirrors the `okr_node_events` pattern.
- Trigger: every write on `tenant_nodes` / `tenant_node_aliases` emits an `entity_resolution_events` row.

### Edge function
- `entity-resolve` wrapped with `withLogger`, auth = operator JWT or `x-awip-service-token`.
- Input validated by `ResolverRetrievalInputSchema` (already in `retrieval-resolver.ts`).
- Match order = `RESOLVER_MATCH_ORDER`: authoritative → alias_exact → alias_fts (this sprint only goes as far as alias_fts; embedding_hint is s5.2).
- Output matches `ResolverRetrievalOutput`. `authoritativeHit=true` → caller MUST auto-bind.
- Idempotency-Key on every write endpoint (`/entity/bind`, `/entity/alias/create`).

### UI
- `/entities` page (sidebar group Knowledge): tab "Resolver" with a probe form (paste descriptors → see candidates + scores + match source). Read-only this sprint. Add to `observability_registry` so the missing-watcher sentinel covers it from day one.

### Tests
- `e2e/resolver.test.ts`: authoritative ID short-circuits; alias_exact wins over alias_fts; cross-tenant collision returns empty (the gate test); revoked alias is invisible; one batch → one approval.
- Contract test already in `retrieval_contracts_test.ts` stays green.

### Acceptance
- Migration applied; RLS verified by `bun run rls:verify`.
- `entity-resolve` deployed, `withLogger` coverage check passes.
- Cross-tenant test red without the `tenant_id` filter, green with it.
- `/entities` probe returns candidates against seed fixtures.

---

## s5.2 — Resolver scoring + ancestry (flips ADR-0003)

**Goal:** ambiguous matches get ranked, ancestry queries scale.

### Database
- ADR-0003 decision: denormalised `ancestry_ids uuid[]` on `tenant_nodes` (lean direction already in the ADR). Maintained by trigger on parent_id change. GIN index for ancestor lookups.
- `descriptor_weights` table (kind → default_weight, per-tenant override row). Seed defaults: postcode 0.9, authoritative 1.0, free-text name 0.5, address 0.7.
- View `v_resolver_health` (auto_bind_rate, conflicts_per_1k, cross_tenant_near_misses_24h) for Phase 6b prep.

### Edge function
- Add `alias_fts` weighted scoring (composite weighted-sum, configurable per-tenant via `descriptor_weights`).
- Add `embedding_hint` as last-resort match source — calls `gemini-embedding-001` per accepted ADR-0006, stores `embedding_model_version`. Cost-capped: hint only fires when descriptors ≥ 2 and no alias hit.
- Confidence bands: `≥0.85 auto_bind`, `0.55..0.85 conflict`, `<0.55 no_match`. Bands per-tenant overridable.

### Bench
- `scripts/adr-bench/adr-0003-ancestry.ts` already throws until `tenant_nodes` exists — now runs. Capture p95 ancestor lookup at synthetic depth 6, 10, 14 over 100k nodes.
- `uploadBenchResult()` writes to `adr_bench_results`; paste numbers into ADR-0003 Consequences; flip ADR-0003 `proposed → accepted` in same PR; CHANGELOG `### Decided` bullet.

### UI
- `/entities` Resolver tab: show confidence band, matched descriptors, ancestor chain. Add Conflicts tab listing `entity_resolution_conflicts` open rows with one-click approve/reject (uses `resolve_truth()`).

### Tests
- Scoring test matrix (one row per descriptor combo + expected band).
- Cross-tenant near-miss test increments the counter.
- Bench script exit 0 + result row in `adr_bench_results`.

### Acceptance
- ADR-0003 status flipped, evidence visible at `/admin/adr-bench`.
- `/entities` Conflicts tab clears a seeded conflict end-to-end.
- `v_resolver_health` returns non-null rows.

---

## s5.3 — Alias lifecycle (flips ADR-0004)

**Goal:** aliases are safely revocable; merge/split are first-class.

### Database
- ADR-0004 decision: **hybrid soft+hard** (lean direction in stub). Schema:
  - `tenant_node_aliases.revoked_at` (soft, already in s5.1).
  - New `alias_revocations` (id, alias_id, kind ∈ soft|hard, reason, requested_by, approved_by, approved_at, fact_review_count).
  - Trigger: on revoke, flag every previously-bound fact (`fact_review_required=true` on a column added in this migration) — Phase 6 reads it. Until then, count goes into `entity_resolution_events`.
- `tenant_node_merges` + `tenant_node_splits` tables. Approval kind `entity.merge` / `entity.split` registered in `decision_authorities` (operator beats AI, system can propose).

### Edge function
- `/entity/alias/revoke` (admin-only, requires explicit reason, raises an approval).
- `/entity/merge` + `/entity/split` raise approvals; on approve, the resolver re-emits events and increments the re-review counter.

### Bench
- `scripts/adr-bench/adr-0004-revocation.ts` runs. Measure: time to flag N facts at N = 1k, 10k, 100k bound rows. Threshold from `docs/adr/benchmarks.md`.
- Flip ADR-0004 `proposed → accepted` with numbers in Consequences; CHANGELOG bullet.

### UI
- `/entities` Aliases tab: search, revoke (with reason), see re-review count. Merge/split wizards behind admin role.
- Add row to `observability_registry` for alias_revocations write rate; watcher fires if rate spikes (lessons-loop pattern detector).

### Tests
- Revoke alias → fact_review_required flips on bound facts (use a stub `canonical_facts` table created in this migration as a placeholder, deleted in Phase 6).
- Merge: both source nodes → `status=merged`, `superseded_by=target`; resolver returns target.
- Split: source → `status=split`, two children inherit; resolver routes by parent.

### Acceptance
- ADR-0004 flipped.
- All three approval kinds (`entity.merge`, `entity.split`, `entity.alias.revoke`) appear in `decision_authorities` with operator precedence.
- `bun run rls:verify`, logger coverage, lint ratchet, contract tests all green.

---

## Phase exit (after s5.3)

- All three sprints `done`; phase gates green (structural / QA / night audits / approvals).
- Operator clicks **Proceed → Request phase sign-off** on `/roadmap` → `roadmap.phase_signoff` approval → phase done.
- `/master-plan` shows Phase 5 closed; Phase 6 unblocked.
- Memory updates:
  - New `mem/features/entity-resolver.md` — invariants, tables, edge function, watchers.
  - Append to `mem/features/phase-5-6-prep.md` — ADR-0003 + 0004 accepted, link to bench rows.
  - Index entry under Core if a new always-on rule emerges (e.g. "resolver never crosses tenant_id").

## Double-check / validation cadence (per sprint)

1. **Before merge:** persona consultation per `mem://preferences/verify-completion` — `tenant-manager` (RLS + cross-tenant), `event-engineer` (events emitted), `compliance-auditor` (approval kinds), `sentinel` (watchers registered).
2. **Live verification:** `supabase--read_query` on the new tables, `curl_edge_functions` against `/entity/*`, check `automation_runs` for the new function.
3. **Bench:** run script, confirm row in `adr_bench_results`, screenshot the `/admin/adr-bench` pill.
4. **Doc drift:** `bun run scripts/check-doc-drift.ts` clean.
5. **CI:** poll `GITHUB_REVIEWS_TOKEN` after push lands — green run on `main` is the only proof CI passed.

## Technical notes (skip if non-technical)

- Migration files numbered sequentially under `supabase/migrations/`; one per sprint to keep rollback granular.
- `entity-resolve` lives at `supabase/functions/entity-resolve/index.ts`; reuses `_shared/logger.ts`, `_shared/model-policy.ts` (embedding hint forced to night-cheap model 22:00–06:00 UTC), `_shared/contracts/retrieval-resolver.ts`.
- `phase-contract-map.ts` already binds `phase-5` to `RESOLVER_RETRIEVAL_CONTRACT` + `[ADR-0003, ADR-0004]` — no change needed there.
- Lint: any new file must satisfy `no-explicit-any` as error (auto-promoted if not in `.lint-baselines/no-explicit-any.json`).
- Bench scripts use `psql` via `Deno.Command` (pattern from ADR-0006 bench), no `pg` driver.

---

**On approval I implement s5.1 only**, then stop for review before s5.2.
