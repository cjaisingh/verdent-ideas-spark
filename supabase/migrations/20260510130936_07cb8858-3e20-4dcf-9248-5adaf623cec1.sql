-- Make roadmap_task_outcome_health respect caller RLS
ALTER VIEW public.roadmap_task_outcome_health SET (security_invoker = true);