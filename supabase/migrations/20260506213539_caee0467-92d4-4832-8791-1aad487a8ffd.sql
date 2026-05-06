
CREATE TYPE public.notebook_kind AS ENUM ('thought','issue','research','suggestion','todo');
CREATE TYPE public.notebook_status AS ENUM ('open','in_progress','resolved','archived');

CREATE TABLE public.notebook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.notebook_kind NOT NULL DEFAULT 'thought',
  title text NOT NULL,
  body text,
  tags text[] NOT NULL DEFAULT '{}',
  status public.notebook_status NOT NULL DEFAULT 'open',
  pinned boolean NOT NULL DEFAULT false,
  author text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notebook_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read notebook" ON public.notebook_entries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'operator'::app_role) OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators write notebook" ON public.notebook_entries
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'operator'::app_role) OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators update notebook" ON public.notebook_entries
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'operator'::app_role) OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators delete notebook" ON public.notebook_entries
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'operator'::app_role) OR public.has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER notebook_entries_updated_at
  BEFORE UPDATE ON public.notebook_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_notebook_kind_created ON public.notebook_entries(kind, created_at DESC);
CREATE INDEX idx_notebook_pinned ON public.notebook_entries(pinned, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notebook_entries;
