CREATE TABLE public.runbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  format text NOT NULL DEFAULT 'markdown', -- 'markdown' | 'yaml'
  body text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{title, detail}]
  tags text[] NOT NULL DEFAULT '{}',
  author text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.runbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read runbooks" ON public.runbooks
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write runbooks" ON public.runbooks
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

CREATE TRIGGER runbooks_set_updated_at
  BEFORE UPDATE ON public.runbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_runbooks_updated_at ON public.runbooks(updated_at DESC);