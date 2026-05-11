alter table public.morning_review_triage drop constraint morning_review_triage_item_kind_check;
alter table public.morning_review_triage add constraint morning_review_triage_item_kind_check
  check (item_kind in (
    'panel',
    'discussion_action','sentinel_finding','code_review_finding',
    'cron_stuck','deferred','promotion_drift','night_throughput'
  ));