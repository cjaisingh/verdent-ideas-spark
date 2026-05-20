---
name: Per-task cost accounting
description: ai_usage_log.task_id+module, v_ai_cost_per_sprint view, SprintCostRollup card on /master-plan
type: feature
---

`ai_usage_log` gained `task_id uuid → roadmap_tasks` and `module text`. The shared `logAiUsage`/`logAiCall` helpers (`supabase/functions/_shared/ai-usage.ts`) accept both. Forward-only attribution: callers must pass `task_id` to get a row tied to a sprint.

Views: `v_ai_cost_per_task` and `v_ai_cost_per_sprint` (both `security_invoker=on`). One-shot `backfill_ai_usage_attribution()` sets `module` from `infer_ai_job_module(job)`; historical task_id stays NULL because `roadmap_tasks.module` uses workstream names (`core`, `ingest`...) not feature slugs.

UI: `SprintCostRollup` card on `/master-plan` § "Cost effectiveness by sprint" reads the view. Shows attributed_calls/tokens/$ and $/done-task. Will read 0 until edge functions inside task work start passing `task_id`.
