-- Postmortems for slipped phases/sprints
CREATE TABLE public.postmortems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL CHECK (subject_kind IN ('phase','sprint')),
  subject_id uuid NOT NULL,
  subject_label text NOT NULL,
  slipped_on date NOT NULL,
  days_late integer NOT NULL DEFAULT 0,
  root_cause text,
  contributing_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  what_changed text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','archived')),
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  CONSTRAINT postmortems_subject_slip_unique UNIQUE (subject_kind, subject_id, slipped_on)
);

CREATE INDEX idx_postmortems_status_created ON public.postmortems (status, created_at DESC);
CREATE INDEX idx_postmortems_subject ON public.postmortems (subject_kind, subject_id);

ALTER TABLE public.postmortems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read postmortems"
ON public.postmortems FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins update postmortems"
ON public.postmortems FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins delete postmortems"
ON public.postmortems FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Inserts are service-role only (cron). No INSERT policy for authenticated.

ALTER PUBLICATION supabase_realtime ADD TABLE public.postmortems;
ALTER TABLE public.postmortems REPLICA IDENTITY FULL;