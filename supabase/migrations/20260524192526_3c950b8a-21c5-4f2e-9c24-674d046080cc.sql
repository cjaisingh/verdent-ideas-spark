ALTER TABLE public.discussion_actions
  ADD COLUMN IF NOT EXISTS blocked_reason text;

COMMENT ON COLUMN public.discussion_actions.blocked_reason IS
  'Free-text reason when status=''blocked''. Surfaces on /morning-review and /operator-inbox.';

CREATE INDEX IF NOT EXISTS idx_discussion_actions_blocked
  ON public.discussion_actions (status)
  WHERE status = 'blocked';