-- 1) panel-ref column on discussion_actions + per-panel uniqueness for open jobs
ALTER TABLE public.discussion_actions
  ADD COLUMN IF NOT EXISTS morning_review_panel_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS discussion_actions_open_per_mr_panel
  ON public.discussion_actions (morning_review_panel_ref)
  WHERE status = 'open' AND morning_review_panel_ref IS NOT NULL;

-- 2) night_shift_job_attempts
CREATE TABLE IF NOT EXISTS public.night_shift_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.discussion_actions(id) ON DELETE CASCADE,
  night_shift_id uuid REFERENCES public.night_shifts(id) ON DELETE SET NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL DEFAULT 'no_change'
    CHECK (outcome IN ('no_change','progressed','closed'))
);
CREATE INDEX IF NOT EXISTS idx_nsja_action_attempted
  ON public.night_shift_job_attempts (action_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_nsja_shift
  ON public.night_shift_job_attempts (night_shift_id);

ALTER TABLE public.night_shift_job_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators read night_shift_job_attempts" ON public.night_shift_job_attempts;
CREATE POLICY "operators read night_shift_job_attempts"
  ON public.night_shift_job_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "no client write night_shift_job_attempts" ON public.night_shift_job_attempts;
CREATE POLICY "no client write night_shift_job_attempts"
  ON public.night_shift_job_attempts FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.night_shift_job_attempts;

-- 3) view: jobs stuck in night for 3+ attempts
CREATE OR REPLACE VIEW public.discussion_actions_stuck_in_night
WITH (security_invoker = true) AS
SELECT
  da.id,
  da.short_num,
  da.title,
  da.risk,
  da.priority,
  COUNT(a.id) AS attempts,
  MAX(a.attempted_at) AS last_attempt_at
FROM public.discussion_actions da
JOIN public.night_shift_job_attempts a ON a.action_id = da.id
WHERE da.status = 'open'
  AND da.night_eligible = true
  AND da.promoted_task_id IS NULL
GROUP BY da.id, da.short_num, da.title, da.risk, da.priority
HAVING COUNT(a.id) >= 3;

-- 4) widen morning_review_discussions outcome to cover new resolutions
ALTER TABLE public.morning_review_discussions
  DROP CONSTRAINT IF EXISTS morning_review_discussions_outcome_check;
ALTER TABLE public.morning_review_discussions
  ADD CONSTRAINT morning_review_discussions_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('mirrored','deferred','done','skipped','fixed','cancelled','escalated'));
