CREATE TABLE IF NOT EXISTS public.roadmap_autolog_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT true,
  capture_tokens boolean NOT NULL DEFAULT true,
  capture_duration boolean NOT NULL DEFAULT true,
  capture_model boolean NOT NULL DEFAULT true,
  capture_prompt boolean NOT NULL DEFAULT true,
  capture_response boolean NOT NULL DEFAULT true,
  capture_request_meta boolean NOT NULL DEFAULT true,
  capture_response_meta boolean NOT NULL DEFAULT true,
  extract_issues_fixes boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.roadmap_autolog_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read autolog settings"
  ON public.roadmap_autolog_settings FOR SELECT
  TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write autolog settings"
  ON public.roadmap_autolog_settings FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

INSERT INTO public.roadmap_autolog_settings (id) VALUES (true) ON CONFLICT DO NOTHING;