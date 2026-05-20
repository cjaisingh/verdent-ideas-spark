ALTER VIEW public.v_ai_cost_per_task   SET (security_invoker = on);
ALTER VIEW public.v_ai_cost_per_sprint SET (security_invoker = on);
-- infer_ai_job_module is IMMUTABLE and pure; lock down execution to authenticated only
REVOKE EXECUTE ON FUNCTION public.infer_ai_job_module(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.backfill_ai_usage_attribution() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.backfill_ai_usage_attribution() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.infer_ai_job_module(text) TO authenticated;