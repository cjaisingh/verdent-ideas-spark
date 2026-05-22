# Session Lifecycle

Every Lovable / Claude Code / Cursor session against AWIP Core follows the same start / end contract. The contract exists to stop sessions starting blind to open findings and ending without a written summary.

## Session start checklist

Before touching files:

1. Read `mem/index.md` Core + Memories list — already injected.
2. `read_query` open `sentinel_findings` (`status='open'`, last 24h).
3. `read_query` open `discussion_actions` (`status in ('open','in_progress')`).
4. Skim `.lovable/plan.md` — current plan and out-of-scope footer.
5. Acknowledge bootstrap: POST to `session-summary-log` with the session_id + `bootstrap_acknowledged: true` is optional but recommended.

If any open finding is severity `high` or `critical` and relates to the area you are about to change, raise it before proceeding.

## Session end checklist

Before claiming done:

1. Verify changes per `mem://preferences/verify-completion` (tests / curl / read_query / replay).
2. Post any "Out of scope" bullets from `.lovable/plan.md` to `plan-footer-ingest`.
3. POST a session summary to `session-summary-log` with:
   - `session_id`, `agent`, `started_at`, `ended_at`
   - `goal`, `outcome`
   - `files_touched`, `migrations_applied`, `edge_fns_touched`
   - `out_of_scope: string[]` — anything deferred during the session
   - `decisions`, `followups`, `unresolved`
4. Update `CHANGELOG.md` if a durable rule, schema, or surface changed.
5. Update `mem/index.md` if a new rule needs to ride along on every future session.

## Why both endpoints

`plan-footer-ingest` captures gaps **declared up front** in the plan footer.
`session-summary-log` captures gaps **discovered mid-flight** that were never in the plan.

Both fan out to `discussion_actions` through the same writer (`recordOutOfScope`), tagged with `source='plan_footer'` or `source='session_summary'` and a stable `source_ref` (`plan:<id>` / `session:<id>`).

The `out_of_scope_stale` sentinel (medium) fires when an auto-logged row stays `open` for >14 days, so nothing rots silently.

## References

- [`docs/out-of-scope-autolog.md`](./out-of-scope-autolog.md) — full contract, regex, idempotency rules
- [`supabase/functions/plan-footer-ingest/index.ts`](../supabase/functions/plan-footer-ingest/index.ts)
- [`supabase/functions/session-summary-log/index.ts`](../supabase/functions/session-summary-log/index.ts)
- [`mem://features/out-of-scope-autolog`](../mem/features/out-of-scope-autolog.md)
- [`mem://preferences/verify-completion`](../mem/preferences/verify-completion.md)

## Related

- [`docs/runbooks/observability-freshness.md`](./runbooks/observability-freshness.md) — how `session-bootstrap` ties into the freshness detector and how to read the three legitimate stale signals.
