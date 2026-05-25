ALTER TABLE public.okr_nodes
  ADD COLUMN IF NOT EXISTS projected_value_usd numeric,
  ADD COLUMN IF NOT EXISTS realized_value_usd numeric;

ALTER TABLE public.discussion_actions
  ADD COLUMN IF NOT EXISTS projected_value_usd numeric,
  ADD COLUMN IF NOT EXISTS realized_value_usd numeric;

COMMENT ON COLUMN public.okr_nodes.projected_value_usd IS
  'Operator-authoritative estimate of the USD value of reaching this KR. Never AI-written without operator approval. KR is the canonical home of value; rollup helpers prefer this over discussion_actions overrides.';
COMMENT ON COLUMN public.okr_nodes.realized_value_usd IS
  'Operator-recorded realised USD value once the KR is closed.';
COMMENT ON COLUMN public.discussion_actions.projected_value_usd IS
  'Optional value override for actions not linked to a KR. Ignored by rollup when the parent KR has projected_value_usd set.';
COMMENT ON COLUMN public.discussion_actions.realized_value_usd IS
  'Optional realised value for actions not linked to a KR.';