# Out-of-Scope Auto-Logger

When a plan ships with an **Out of scope** footer, those bullets used to live
only in prose — no DB row, no triage, no Morning Review presence. This
contract closes the gap: every out-of-scope item becomes a
`discussion_actions` row automatically.

## Surfaces

| Caller | Source tag | source_ref shape |
|---|---|---|
| `plan-footer-ingest` edge fn (origin=core, default) | `plan_footer` | `plan:<plan_id>` |
| `plan-footer-ingest` edge fn (origin=companion\|rork) | `plan_footer` | `plan:<origin>:<plan_id>` |
| `session-summary-log` edge fn | `session_summary` | `session:<session_summary_id>` |

Cross-project callers (AWIP Companion browser surface, Rork iPhone app) MUST pass `origin: "companion" | "rork"` in the JSON body so the origin is preserved in `source_ref`. Core callers may omit `origin` — it defaults to `"core"` and keeps the legacy `plan:<id>` shape.


Both call the shared writer at `supabase/functions/_shared/out-of-scope.ts`
(`recordOutOfScope`). The writer is the single point of truth — never
insert into `discussion_actions` with `source in ('plan_footer','session_summary')`
from anywhere else.

## Idempotency

Migration `20260521_out_of_scope_autolog` adds a partial unique index:

```sql
CREATE UNIQUE INDEX uniq_discussion_actions_autolog
  ON public.discussion_actions (source, source_ref, title)
  WHERE source IN ('plan_footer','session_summary')
    AND source_ref IS NOT NULL;
```

Re-posting the same plan or session summary returns `created_count: 0,
skipped_count: N`. Safe to call from retries.

## Parser

`parseOutOfScope(markdown)` accepts H1–H4 headings whose text matches
(case-insensitive):

- `Out of scope` (also `Out of Scope (for this PR)`)
- `Not in scope`
- `Deferred`
- `Won't do` / `Won't ship`

Bullets recognised: `-`, `*`, `+`, `1.`, `1)`. Capture ends at the next
heading of equal-or-higher level.

## Sentinel watch

`out_of_scope_stale` runs every 15 min inside `sentinel-tick`. Any
auto-logged action with `status='open'` for >14 days emits a `medium`
finding, grouped by `(source, source_ref)` so a noisy plan does not fan out
into dozens of identical findings.

Recovery: either set the action to `done`/`won't_do` with a reason, or
promote it. Findings auto-clear on the next tick once the rows are no
longer stale.

## Observability registry

Both the edge fn and the watcher are declared in
`public.observability_registry`:

| surface_kind | surface_id | watcher_kinds |
|---|---|---|
| edge_fn | plan-footer-ingest | edge_function_error_rate, five_xx_spike |
| agent | out_of_scope_stale | out_of_scope_stale |

## Working agreement

> Every plan that ships with an **Out of scope** footer **must** be POSTed
> to `plan-footer-ingest` before the session is closed. Same for
> `session-summary-log` when `out_of_scope[]` is non-empty.

## Out of scope (for this PR)

- Read-only `source` badge on the Morning Review Discussion Actions panel
  (deferred — purely cosmetic).
- Backfilling historical plans/sessions (only forward-looking by design).
- Cross-project ingest from Companion / Rork surfaces.
