
-- 1. Force security_invoker on every public view that doesn't already have it.
ALTER VIEW public.v_alias_lineage_health            SET (security_invoker = on);
ALTER VIEW public.v_automation_runs_latest_per_job  SET (security_invoker = on);
ALTER VIEW public.v_automation_step_p95_30d         SET (security_invoker = on);
ALTER VIEW public.v_caprica_inbox_24h               SET (security_invoker = on);
ALTER VIEW public.v_job_eta_baseline                SET (security_invoker = on);
ALTER VIEW public.v_jobs_recent                     SET (security_invoker = on);
ALTER VIEW public.v_observability_registry_status   SET (security_invoker = on);
ALTER VIEW public.v_operator_inbox_24h              SET (security_invoker = on);
ALTER VIEW public.v_operator_inbox_unpromoted       SET (security_invoker = on);
ALTER VIEW public.v_resolver_decisions              SET (security_invoker = on);
ALTER VIEW public.v_resolver_health                 SET (security_invoker = on);

-- 2. Revoke anonymous EXECUTE on internal SECURITY DEFINER functions.
--    Triggers don't actually need EXECUTE grants to fire, and RPCs here are
--    all operator/admin-only (or service-role only). short_link_resolve stays
--    callable by anon because the short-link redirect runs pre-auth.
REVOKE EXECUTE ON FUNCTION public.auto_module_heartbeat_from_event()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_reject_stale_lessons(integer)         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_tenant_alias_event()                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_tenant_node_event()                   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.governance_uncovered_tasks(integer, text)  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_in_tenant_subtree(uuid)                 FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_postmortem_event()                     FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_qa_check_event()                       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_scheduled_job_event()                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_alias_embedding(uuid, vector, double precision, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.observability_cron_last_seen()             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_console_captures()                   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reclaim_stale_ai_jobs(integer)             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_entity(uuid, jsonb)                FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_entity_logged(uuid, jsonb, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_module_token(text)                 FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.runtime_cron_status(text[])                FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.table_surface_last_seen(text)              FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tag_qa_check_actor()                       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_node_alias_effective(uuid)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_node_compute_ancestry(uuid, uuid)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_canonical_facts_forbid_delete()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_canonical_facts_forbid_update()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_canonical_facts_set_ancestry()          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_ingest_events_append_only()             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_source_mappings_lock_approved()         FROM anon, PUBLIC;

-- 3. Pin search_path on the one user-defined function missing it.
ALTER FUNCTION public.normalise_alias(text) SET search_path = public, pg_temp;
