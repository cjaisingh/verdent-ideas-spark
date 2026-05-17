
-- credit_entries: manual ledger
CREATE TABLE public.credit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.roadmap_tasks(id) ON DELETE SET NULL,
  phase_id uuid REFERENCES public.roadmap_phases(id) ON DELETE SET NULL,
  step_label text NOT NULL,
  credits numeric(10,2) NOT NULL CHECK (credits >= 0),
  mode text NOT NULL DEFAULT 'build' CHECK (mode IN ('build','plan','try-to-fix','other')),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_entries_occurred ON public.credit_entries (occurred_at DESC);
CREATE INDEX idx_credit_entries_phase ON public.credit_entries (phase_id);
CREATE INDEX idx_credit_entries_task ON public.credit_entries (task_id);

ALTER TABLE public.credit_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read credit_entries" ON public.credit_entries
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write credit_entries" ON public.credit_entries
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_entries;

-- credit_settings: singleton
CREATE TABLE public.credit_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  proxy_rate_per_1k_tokens numeric(10,4) NOT NULL DEFAULT 0.05,
  monthly_budget_credits integer,
  alert_threshold_pct integer NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.credit_settings (id) VALUES (true);

ALTER TABLE public.credit_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read credit_settings" ON public.credit_settings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write credit_settings" ON public.credit_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

-- v_credit_burn_per_step: unioned manual + proxy
CREATE OR REPLACE VIEW public.v_credit_burn_per_step AS
SELECT
  ce.id,
  ce.occurred_at,
  ce.task_id,
  COALESCE(ce.phase_id, s.phase_id) AS phase_id,
  ce.step_label,
  'manual'::text AS source,
  ce.credits,
  NULL::integer AS tokens_total,
  NULL::text AS model,
  NULL::integer AS duration_ms,
  ce.mode,
  ce.note
FROM public.credit_entries ce
LEFT JOIN public.roadmap_tasks t ON t.id = ce.task_id
LEFT JOIN public.roadmap_sprints s ON s.id = t.sprint_id

UNION ALL

SELECT
  wl.id,
  wl.started_at AS occurred_at,
  wl.task_id,
  s.phase_id,
  COALESCE(LEFT(wl.summary, 80), 'work_log entry') AS step_label,
  'proxy'::text AS source,
  ROUND(((COALESCE(wl.tokens_total, 0)::numeric / 1000.0) * cs.proxy_rate_per_1k_tokens)::numeric, 4) AS credits,
  wl.tokens_total,
  wl.model,
  wl.duration_ms,
  NULL::text AS mode,
  NULL::text AS note
FROM public.roadmap_work_log wl
JOIN public.roadmap_tasks t ON t.id = wl.task_id
JOIN public.roadmap_sprints s ON s.id = t.sprint_id
CROSS JOIN public.credit_settings cs
WHERE COALESCE(wl.tokens_total, 0) > 0;

-- v_credit_burn_per_phase_30d: 30-day rollup
CREATE OR REPLACE VIEW public.v_credit_burn_per_phase_30d AS
SELECT
  p.id AS phase_id,
  p.key AS phase_key,
  p.title AS phase_title,
  COALESCE(SUM(CASE WHEN v.source = 'manual' THEN v.credits END), 0)::numeric(12,2) AS manual_credits,
  COALESCE(SUM(CASE WHEN v.source = 'proxy' THEN v.credits END), 0)::numeric(12,2) AS proxy_credits,
  COALESCE(SUM(v.credits), 0)::numeric(12,2) AS total_credits,
  COUNT(*) FILTER (WHERE v.source = 'manual') AS manual_count,
  COUNT(*) FILTER (WHERE v.source = 'proxy') AS proxy_count
FROM public.roadmap_phases p
LEFT JOIN public.v_credit_burn_per_step v
  ON v.phase_id = p.id
  AND v.occurred_at >= now() - interval '30 days'
GROUP BY p.id, p.key, p.title
HAVING COALESCE(SUM(v.credits), 0) > 0
ORDER BY total_credits DESC;
