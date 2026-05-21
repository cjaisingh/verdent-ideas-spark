-- 1. source_ref column on discussion_actions
ALTER TABLE public.discussion_actions
  ADD COLUMN IF NOT EXISTS source_ref text;

CREATE INDEX IF NOT EXISTS idx_discussion_actions_source_ref
  ON public.discussion_actions (source, source_ref)
  WHERE source_ref IS NOT NULL;

-- 2. Idempotency: same plan/session + same title cannot be logged twice
CREATE UNIQUE INDEX IF NOT EXISTS uniq_discussion_actions_autolog
  ON public.discussion_actions (source, source_ref, title)
  WHERE source IN ('plan_footer','session_summary')
    AND source_ref IS NOT NULL;

-- 3. Observability registry rows for new surfaces
INSERT INTO public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds,
   domain_silence_window_hours, owner, notes, declared_in)
VALUES
  ('edge_fn', 'plan-footer-ingest', NULL,
   ARRAY['edge_function_error_rate','five_xx_spike']::text[],
   NULL, 'awip-core',
   'POST endpoint that parses Out-of-Scope sections of plans into discussion_actions. Failure means scope leaks vanish.',
   'docs/out-of-scope-autolog.md'),
  ('agent', 'out_of_scope_stale', 15,
   ARRAY['out_of_scope_stale']::text[],
   336, 'awip-core',
   'Sentinel check: any plan_footer/session_summary discussion_action open >14 days → medium finding.',
   'docs/out-of-scope-autolog.md')
ON CONFLICT (surface_kind, surface_id) DO UPDATE
  SET watcher_kinds = EXCLUDED.watcher_kinds,
      notes = EXCLUDED.notes,
      declared_in = EXCLUDED.declared_in,
      updated_at = now();