## Problem

On `/plan`, workstreams **W5 Deep Audit** (7/7 tasks done, 100%) and **W6 Doc-Drift + GitHub CI** (9/9 tasks done, 100%) still display the **To do** chip.

Root cause: `plan_workstreams.status` is set per workstream and is independent of task completion. Both rows are still `'todo'` in the database even though every child `plan_tasks` row is `done`. The UI shows the literal status, not a derived one.

```
deep-data    | W5 Deep Audit            | status=todo  | 7/7 done
doc-drift-ci | W6 Doc-Drift + GitHub CI | status=todo  | 9/9 done
```

## Fix

One small migration to flip both rows to `done`:

```sql
update public.plan_workstreams
   set status = 'done', updated_at = now()
 where slug in ('deep-audit', 'doc-drift-ci');
```

That's it — the `/plan` page subscribes to realtime `plan_workstreams` changes and will re-render the chips immediately. No code changes needed.

## Optional follow-up (not in this plan unless you want it)

The drift will keep happening as long as workstream status is hand-maintained. If you want, I can add a trigger on `plan_tasks` that auto-promotes the parent workstream to `done` when 100% of its tasks are `done` (and back to `active` if a task reopens). Say the word and I'll fold it in.