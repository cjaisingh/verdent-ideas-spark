---
name: AI attribution mappings
description: Configurable job→module patterns + module→task pins drive infer_ai_job_module and backfill_ai_usage_attribution
type: feature
---
Tables `public.ai_module_mappings` (pattern, module, priority, enabled) and `public.ai_module_task_pins` (module, task_id, effective_from, effective_to) replace the hardcoded job→module switch. `infer_ai_job_module()` is now STABLE and reads the mappings table (highest priority then longest pattern wins). `backfill_ai_usage_attribution()` runs in 3 phases: fill module from pattern, attach task_id from pin if any pin covers `created_at`, fall back to the existing "most recent task in same module updated ≤ log.created_at" heuristic. Operator UI at `/admin/ai-usage` → "Attribution" tab; "Run backfill" button calls the RPC. RLS: operator/admin only on both tables.
