
-- Evidence table
CREATE TABLE public.roadmap_task_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  checklist_item text,
  kind text NOT NULL DEFAULT 'link', -- link | file | note
  title text NOT NULL,
  url text,
  storage_path text,
  note text,
  source text,
  added_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_task ON public.roadmap_task_evidence(task_id);
CREATE INDEX idx_evidence_checklist ON public.roadmap_task_evidence(task_id, checklist_item);

ALTER TABLE public.roadmap_task_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read evidence" ON public.roadmap_task_evidence
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert evidence" ON public.roadmap_task_evidence
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators update evidence" ON public.roadmap_task_evidence
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators delete evidence" ON public.roadmap_task_evidence
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE TRIGGER trg_evidence_updated_at
  BEFORE UPDATE ON public.roadmap_task_evidence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_task_evidence;

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('roadmap-evidence', 'roadmap-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "operators read roadmap evidence files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'roadmap-evidence' AND public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write roadmap evidence files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'roadmap-evidence' AND public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators update roadmap evidence files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'roadmap-evidence' AND public.has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (bucket_id = 'roadmap-evidence' AND public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators delete roadmap evidence files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'roadmap-evidence' AND public.has_role(auth.uid(), 'operator'::app_role));
