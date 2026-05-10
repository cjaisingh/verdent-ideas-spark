-- Add okr_node_id + okr_link_kind to roadmap_tasks for Phase 4 (OKR-driven execution) outcome wiring
ALTER TABLE public.roadmap_tasks
  ADD COLUMN IF NOT EXISTS okr_node_id uuid REFERENCES public.okr_nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS okr_link_kind text;

ALTER TABLE public.roadmap_tasks
  DROP CONSTRAINT IF EXISTS roadmap_tasks_okr_link_kind_chk;
ALTER TABLE public.roadmap_tasks
  ADD CONSTRAINT roadmap_tasks_okr_link_kind_chk
  CHECK (okr_link_kind IS NULL OR okr_link_kind IN ('contributes_to','delivers','measures'));

CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_okr_node ON public.roadmap_tasks(okr_node_id);

-- Read-only outcome view: each task with linked okr node summary
CREATE OR REPLACE VIEW public.roadmap_task_outcome_health AS
SELECT
  t.id           AS task_id,
  t.key          AS task_key,
  t.title        AS task_title,
  t.status::text AS task_status,
  t.okr_link_kind,
  n.id           AS okr_node_id,
  n.title        AS okr_title,
  n.kind::text   AS okr_kind,
  n.status::text AS okr_status
FROM public.roadmap_tasks t
LEFT JOIN public.okr_nodes n ON n.id = t.okr_node_id;

GRANT SELECT ON public.roadmap_task_outcome_health TO authenticated;