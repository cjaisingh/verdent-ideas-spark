-- Tomorrow Plan dashboard (daily_plans is taken by the AI overnight-plan feature)
CREATE TABLE public.tomorrow_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  notes text,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tomorrow_plan_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.tomorrow_plans(id) ON DELETE CASCADE,
  ordinal int NOT NULL,
  title text NOT NULL,
  est_minutes int,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, ordinal)
);

CREATE TABLE public.tomorrow_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.tomorrow_plan_blocks(id) ON DELETE CASCADE,
  ordinal int NOT NULL,
  label text NOT NULL,
  detail text,
  source_kind text NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('sentinel_finding','discussion_action','cron','manual')),
  source_ref text,
  auto_done boolean,
  manual_done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tplan_blocks_plan ON public.tomorrow_plan_blocks(plan_id, ordinal);
CREATE INDEX idx_tplan_items_block ON public.tomorrow_plan_items(block_id, ordinal);

ALTER TABLE public.tomorrow_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tomorrow_plan_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tomorrow_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read tomorrow_plans" ON public.tomorrow_plans FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "operators write tomorrow_plans" ON public.tomorrow_plans FOR ALL
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "operators read tomorrow_plan_blocks" ON public.tomorrow_plan_blocks FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "operators write tomorrow_plan_blocks" ON public.tomorrow_plan_blocks FOR ALL
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "operators read tomorrow_plan_items" ON public.tomorrow_plan_items FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "operators write tomorrow_plan_items" ON public.tomorrow_plan_items FOR ALL
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tomorrow_plans_updated BEFORE UPDATE ON public.tomorrow_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tomorrow_plan_blocks_updated BEFORE UPDATE ON public.tomorrow_plan_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tomorrow_plan_items_updated BEFORE UPDATE ON public.tomorrow_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.stamp_tomorrow_plan_item_done()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (COALESCE(NEW.manual_done,false) OR COALESCE(NEW.auto_done,false))
     AND NEW.done_at IS NULL THEN
    NEW.done_at := now();
  ELSIF NOT (COALESCE(NEW.manual_done,false) OR COALESCE(NEW.auto_done,false)) THEN
    NEW.done_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_tplan_items_stamp BEFORE INSERT OR UPDATE ON public.tomorrow_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_tomorrow_plan_item_done();

ALTER PUBLICATION supabase_realtime ADD TABLE public.tomorrow_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tomorrow_plan_blocks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tomorrow_plan_items;