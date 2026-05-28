
-- =========================================================================
-- W8.1 Global Scheduling Substrate
-- =========================================================================

-- ---------- scheduler_kind_catalog ---------------------------------------
CREATE TABLE public.scheduler_kind_catalog (
  kind             TEXT PRIMARY KEY,
  owning_module    TEXT NOT NULL,
  handler_mode     TEXT NOT NULL CHECK (handler_mode IN ('local','remote')),
  description      TEXT,
  requires_tenant  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduler_kind_catalog TO authenticated;
GRANT ALL ON public.scheduler_kind_catalog TO service_role;
ALTER TABLE public.scheduler_kind_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read kinds" ON public.scheduler_kind_catalog
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins write kinds" ON public.scheduler_kind_catalog
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ---------- module_endpoints ---------------------------------------------
CREATE TABLE public.module_endpoints (
  module               TEXT PRIMARY KEY,
  callback_url         TEXT NOT NULL,
  registered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_dispatch_ok_at  TIMESTAMPTZ,
  last_dispatch_err_at TIMESTAMPTZ,
  last_error           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_endpoints TO authenticated;
GRANT ALL ON public.module_endpoints TO service_role;
ALTER TABLE public.module_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read endpoints" ON public.module_endpoints
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins write endpoints" ON public.module_endpoints
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ---------- external_contacts --------------------------------------------
CREATE TABLE public.external_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name      TEXT NOT NULL,
  organisation      TEXT,
  email             TEXT,
  phone             TEXT,
  telegram_chat_id  TEXT,
  notes             TEXT,
  tenant_id         UUID,           -- optional link to tenant graph
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_external_contacts_tenant ON public.external_contacts(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_contacts TO authenticated;
GRANT ALL ON public.external_contacts TO service_role;
ALTER TABLE public.external_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read contacts" ON public.external_contacts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins write contacts" ON public.external_contacts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ---------- scheduled_jobs -----------------------------------------------
CREATE TABLE public.scheduled_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL,
  owning_module     TEXT NOT NULL DEFAULT 'awip_core',
  tenant_id         UUID,
  subject_type      TEXT CHECK (subject_type IN ('operator','tenant','external_contact')),
  subject_id        UUID,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key        TEXT NOT NULL,
  run_at            TIMESTAMPTZ NOT NULL,
  recurrence        TEXT,                                  -- 5-field cron, null = one-shot
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','done','failed','cancelled','auto_blocked')),
  attempts          INT NOT NULL DEFAULT 0,
  max_retries       INT NOT NULL DEFAULT 3,
  last_error        TEXT,
  result            JSONB,
  locked_until      TIMESTAMPTZ,
  locked_by         TEXT,
  next_run_at       TIMESTAMPTZ,
  enqueued_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  enqueued_via_module TEXT,                                -- module token used (null = operator JWT)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owning_module, dedupe_key)
);
CREATE INDEX idx_scheduled_jobs_due
  ON public.scheduled_jobs(run_at)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_jobs_status_mod ON public.scheduled_jobs(status, owning_module);
CREATE INDEX idx_scheduled_jobs_tenant ON public.scheduled_jobs(tenant_id);
CREATE INDEX idx_scheduled_jobs_subject ON public.scheduled_jobs(subject_type, subject_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_jobs TO authenticated;
GRANT ALL ON public.scheduled_jobs TO service_role;
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read jobs" ON public.scheduled_jobs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins write jobs" ON public.scheduled_jobs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ---------- scheduled_job_events -----------------------------------------
CREATE TABLE public.scheduled_job_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES public.scheduled_jobs(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,        -- enqueued|status_changed|recurrence_changed|cancelled|retried|dispatched|completed|failed
  prev_status  TEXT,
  new_status   TEXT,
  attempt      INT,
  actor        TEXT,                 -- 'operator:<uid>' | 'module:<name>' | 'system:tick'
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scheduled_job_events_job ON public.scheduled_job_events(job_id, created_at DESC);
GRANT SELECT, INSERT ON public.scheduled_job_events TO authenticated;
GRANT ALL ON public.scheduled_job_events TO service_role;
ALTER TABLE public.scheduled_job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read job events" ON public.scheduled_job_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins write job events" ON public.scheduled_job_events
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ---------- Triggers ------------------------------------------------------

-- enforce_fm_tenant_scope: FM jobs must carry tenant_id
CREATE OR REPLACE FUNCTION public.enforce_fm_tenant_scope()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.owning_module IS DISTINCT FROM 'awip_core' AND NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'scheduled_jobs: tenant_id is required when owning_module = % (FM jobs are tenant-scoped)', NEW.owning_module;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_scheduled_jobs_fm_tenant
  BEFORE INSERT OR UPDATE OF owning_module, tenant_id ON public.scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fm_tenant_scope();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_scheduled_jobs_updated
  BEFORE UPDATE ON public.scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_module_endpoints_updated
  BEFORE UPDATE ON public.module_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_external_contacts_updated
  BEFORE UPDATE ON public.external_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- log_scheduled_job_event: audit every state change
CREATE OR REPLACE FUNCTION public.log_scheduled_job_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor TEXT;
BEGIN
  v_actor := CASE
    WHEN auth.uid() IS NOT NULL THEN 'operator:' || auth.uid()::text
    WHEN NEW.enqueued_via_module IS NOT NULL THEN 'module:' || NEW.enqueued_via_module
    ELSE 'system:tick'
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.scheduled_job_events(job_id, event_type, new_status, attempt, actor, detail)
    VALUES (NEW.id, 'enqueued', NEW.status, NEW.attempts, v_actor,
            jsonb_build_object('kind', NEW.kind, 'run_at', NEW.run_at, 'owning_module', NEW.owning_module));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.scheduled_job_events(job_id, event_type, prev_status, new_status, attempt, actor, detail)
    VALUES (NEW.id, 'status_changed', OLD.status, NEW.status, NEW.attempts, v_actor,
            jsonb_build_object('last_error', NEW.last_error));
  END IF;

  IF NEW.recurrence IS DISTINCT FROM OLD.recurrence THEN
    INSERT INTO public.scheduled_job_events(job_id, event_type, attempt, actor, detail)
    VALUES (NEW.id, 'recurrence_changed', NEW.attempts, v_actor,
            jsonb_build_object('from', OLD.recurrence, 'to', NEW.recurrence));
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_scheduled_jobs_log_events
  AFTER INSERT OR UPDATE ON public.scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.log_scheduled_job_event();

-- ---------- Realtime publication -----------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_job_events;

-- ---------- Seed catalog --------------------------------------------------
INSERT INTO public.scheduler_kind_catalog(kind, owning_module, handler_mode, description, requires_tenant) VALUES
  ('reminder.send',                 'awip_core',      'local',  'Send a one-shot reminder to operator/tenant/contact via Telegram + inbox', FALSE),
  ('report.weekly_digest',          'awip_core',      'local',  'Generate and deliver weekly operator digest', FALSE),
  ('rationalisation.lane_eligible', 'awip_core',      'local',  'Mark a rationalisation lane eligible to proceed (24h post-prior-lane gate)', FALSE),
  ('fm1.stakeholder_pulse',         'fm1',            'remote', 'FM1 weekly stakeholder pulse rollup (per tenant)', TRUE);
