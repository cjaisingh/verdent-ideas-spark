# Validation gates

The plan's "Validation gates" section lists the exact commands that will be run after build and the pass criteria for each. Every failure is fixed in place and the gate re-run — failures do not move to "Out of scope" unless they prove the plan itself was wrong.

## Standard gate set

Run these after every plan implementation. Skip a gate only with an explicit one-line justification.

| Gate | Command | Pass criteria |
| --- | --- | --- |
| Lint ratchet | `bun run lint:ratchet` | exit 0; no new `any` outside `.lint-baselines/no-explicit-any.json` |
| Logger coverage | `bun run scripts/check-logger-coverage.ts` (or `deno run` equiv) | every new edge fn either wrapped or `@logger-exempt` |
| RLS verify | `bun run rls:verify` | exit 0; new tables appear in `e2e/rls-policy-map.generated.ts` |
| Doc drift | `bun run scripts/check-doc-drift.ts` | exit 0 |
| Vitest | `bunx vitest run` | all green |
| E2E (touched only) | `bunx vitest run -c vitest.e2e.config.ts e2e/<file>.test.ts` | all green |
| Migration applied | `supabase--read_query` against new table | row shape matches plan |
| Edge fn live | `supabase--curl_edge_functions` happy + auth + idempotency cases | matches §test-plan expectations |
| Observability registry | `read_query` `select * from v_observability_registry_status` | new fn/cron present, not stale |

## ADR-touching plans

Add:

- `bun run scripts/adr-bench/<id>-<name>.ts` writes a row into `adr_bench_results`.
- ADR file flipped `proposed → accepted` with bench numbers in Consequences.
- CHANGELOG `### Decided` bullet referencing the ADR.

## Cron/agent plans

Add:

- 24h post-deploy: `select count(*) from automation_runs where job='<name>' and status='error' and created_at > now() - interval '24 hours';` must be 0 (or explained).
- Sentinel rule for the new failure mode is present in `sentinel-tick`.

## Fix loop

1. Gate fails → read the actual error (don't guess).
2. Compose with `diagnose` skill on the third repeat.
3. Fix the smallest unit that makes the gate pass; re-run the whole gate.
4. After all gates green, re-run the FIRST gate to catch any regression introduced by later fixes.

## Verification discipline

Per `mem://preferences/verification-discipline` and `mem://preferences/verify-completion`: never claim done from "the code looks right". A gate either ran and passed, or it didn't run — say which.

## Output

Into the plan's "Validation gates" section, list each gate as a checkbox with the exact command and the success criterion. After implementation, tick each box only after running it.
