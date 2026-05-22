-- T1: Bulk triage. One-time data fix; no schema change.

-- 1. Cancel exact-title duplicates, keep newest per title.
with ranked as (
  select id, title, created_at,
         row_number() over (partition by lower(title) order by created_at desc) as rn
  from public.discussion_actions
  where status in ('open','in_progress')
)
update public.discussion_actions da
set status = 'cancelled',
    details = coalesce(da.details,'') ||
              E'\n\n[T1 triage 2026-05-22] Cancelled as duplicate of newer row with same title.',
    updated_at = now()
from ranked r
where da.id = r.id and r.rn > 1;

-- 2. Mark items already owned by this session's T-tasks as in_progress.
update public.discussion_actions
set status = 'in_progress',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Owned by current session plan task T4 (claims-resolve-tie edge fn).',
    updated_at = now()
where status = 'open'
  and title in (
    'Call resolve_truth() from service context (SECURITY DEFINER auth.uid() check blocks service role)',
    'resolve_truth() wiring for resolver conflict_open events — W7.2'
  );

update public.discussion_actions
set status = 'in_progress',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Owned by current session plan task T7 (cron-sweep-stalled edge fn).',
    updated_at = now()
where status = 'open'
  and title = 'Lane 7: cron-sweep-stalled edge fn (needs service-role access to cron schema)';

update public.discussion_actions
set status = 'in_progress',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Owned by current session plan task T8 (no-explicit-any 30-file slice).',
    updated_at = now()
where status = 'open'
  and title = 'Lane 6: shrink no-explicit-any baseline beyond freeze (517 files)';

update public.discussion_actions
set status = 'in_progress',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Owned by current session plan task T9 (E2E admin-fixture provisioning script).',
    updated_at = now()
where status = 'open'
  and title = 'E2E admin-fixture provisioning automation';

update public.discussion_actions
set status = 'in_progress',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Owned by current session plan task T5 (hard-revoke admin-role e2e).',
    updated_at = now()
where status = 'open'
  and title = 'Hard-revoke admin-role e2e — needs operator+admin JWT harness, deferred to M4';

update public.discussion_actions
set status = 'in_progress',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Owned by current session plan task T3 (sidebar link for /entities/aliases).',
    updated_at = now()
where status = 'open'
  and title = 'Sidebar link for /entities/aliases — discoverable via /entities but no nav entry yet.';

-- 3. Cancel cross-project-ingestion-paths near-duplicates (3 wordings of one idea, carried 2 sessions).
update public.discussion_actions
set status = 'cancelled',
    details = coalesce(details,'') ||
              E'\n\n[T1 triage 2026-05-22] Cancelled — three wordings of the same Companion/Rork ingestion path debt; will be re-opened as a single ticket when the cross-project ingestion sprint starts.',
    updated_at = now()
where status = 'open'
  and title in (
    'Cross-project (Companion / Rork) ingest path',
    'Cross-project (Companion / Rork) ingestion paths.',
    'Cross-project ingestion of out-of-scope items from Companion or Rork.'
  );