
CREATE TABLE public.roadmap_task_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  item_key text NOT NULL,
  category text NOT NULL DEFAULT 'verify', -- sources | risk | verify | custom
  label text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  note text,
  "order" integer NOT NULL DEFAULT 0,
  checked_by text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, item_key)
);

CREATE INDEX idx_checklist_task ON public.roadmap_task_checklist(task_id, "order");

ALTER TABLE public.roadmap_task_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read checklist" ON public.roadmap_task_checklist
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert checklist" ON public.roadmap_task_checklist
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators update checklist" ON public.roadmap_task_checklist
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators delete checklist" ON public.roadmap_task_checklist
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE TRIGGER trg_checklist_updated_at
  BEFORE UPDATE ON public.roadmap_task_checklist
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_task_checklist;
