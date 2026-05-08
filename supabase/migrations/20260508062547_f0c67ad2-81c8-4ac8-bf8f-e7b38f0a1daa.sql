
CREATE TABLE public.daily_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  for_date date NOT NULL,
  model text NOT NULL,
  focus text,
  plan_md text NOT NULL,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  inputs_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX daily_plans_for_date_idx ON public.daily_plans (for_date DESC);

ALTER TABLE public.daily_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read daily_plans"
  ON public.daily_plans FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "no client write daily_plans"
  ON public.daily_plans FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_plans;
