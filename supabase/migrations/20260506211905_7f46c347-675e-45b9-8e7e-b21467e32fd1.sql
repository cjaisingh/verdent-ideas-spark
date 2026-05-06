
CREATE TABLE public.memory_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  auto_purge_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.memory_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.memory_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read memory_settings"
  ON public.memory_settings FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write memory_settings"
  ON public.memory_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));
