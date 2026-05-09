-- 1. Revoke EXECUTE from anon on all SECURITY DEFINER functions in public that were exposed.
REVOKE EXECUTE ON FUNCTION public.assign_discussion_subject_ordinal() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_finding_short_num() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_copilot_profile() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_app_secret_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_discussion_action_event() FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_overnight_run(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_managed_cron_jobs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_managed_cron_active(text, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_managed_cron_schedule(text, text) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.awip_rag_search(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_user_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_user_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_users_with_roles() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_all_rows(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_rows(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.retention_stats() FROM anon;
-- has_role stays anon+auth executable: it is the canonical RLS helper and only reads user_roles.

-- 2. Explicit deny-write policies on copilot_transcript_turns.
CREATE POLICY "deny client insert on copilot_transcript_turns"
  ON public.copilot_transcript_turns FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "deny client update on copilot_transcript_turns"
  ON public.copilot_transcript_turns FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on copilot_transcript_turns"
  ON public.copilot_transcript_turns FOR DELETE TO anon, authenticated USING (false);

-- 3. Explicit deny-write policies on okr_nodes, okr_measurements, okr_node_events, capability_connectors.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['okr_nodes','okr_measurements','okr_node_events','capability_connectors'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (false)', 'deny client insert on '||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false)', 'deny client update on '||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO anon, authenticated USING (false)', 'deny client delete on '||t, t);
  END LOOP;
END$$;