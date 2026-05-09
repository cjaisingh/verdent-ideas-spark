-- Trigger-only functions: only the database itself should call these.
REVOKE EXECUTE ON FUNCTION public.assign_discussion_subject_ordinal() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_finding_short_num() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bootstrap_copilot_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_app_secret_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_discussion_action_event() FROM PUBLIC;

-- Cron + overnight management: operator UI uses these via authenticated JWT; they self-check via has_role.
REVOKE EXECUTE ON FUNCTION public.list_managed_cron_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_managed_cron_active(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_managed_cron_schedule(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_overnight_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_managed_cron_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_managed_cron_active(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_managed_cron_schedule(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_overnight_run(uuid) TO authenticated;