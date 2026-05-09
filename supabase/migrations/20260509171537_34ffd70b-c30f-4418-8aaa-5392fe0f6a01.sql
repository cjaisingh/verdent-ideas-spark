
CREATE TABLE IF NOT EXISTS public.sentinel_findings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  severity     text NOT NULL DEFAULT 'medium' CHECK (severity IN ('info','low','medium','high','critical')),
  subject_ref  jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary      text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','muted')),
  dedupe_key   text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentinel_findings_status ON public.sentinel_findings(status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sentinel_findings_kind ON public.sentinel_findings(kind, last_seen_at DESC);

ALTER TABLE public.sentinel_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read sentinel_findings"
  ON public.sentinel_findings FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "no client write sentinel_findings"
  ON public.sentinel_findings
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE TRIGGER sentinel_findings_updated_at
  BEFORE UPDATE ON public.sentinel_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.sentinel_findings;
