
-- AI Jobs queue for outsourcing drafting work to local Ollama worker.
-- Pull-based: worker claims jobs via edge fn, posts results, never receives push.

CREATE TABLE public.ai_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  model_tags text[] NOT NULL DEFAULT '{}',
  owner_user_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('draft_changelog_entry','draft_lesson_synthesis','draft_doc_section')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','done','failed','cancelled','auto_blocked')),
  priority int NOT NULL DEFAULT 100,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_model text,
  required_model_tags text[] NOT NULL DEFAULT '{}',
  idempotency_key text UNIQUE,
  created_by uuid,
  claimed_by uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_jobs_queued ON public.ai_jobs (priority, created_at) WHERE status = 'queued';
CREATE INDEX idx_ai_jobs_claimed_hb ON public.ai_jobs (status, heartbeat_at) WHERE status = 'claimed';

CREATE TABLE public.ai_job_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ai_jobs(id) ON DELETE CASCADE,
  attempt int NOT NULL,
  worker_id uuid REFERENCES public.ai_workers(id) ON DELETE SET NULL,
  model text,
  output_text text,
  output_json jsonb,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_job_results_job ON public.ai_job_results (job_id, created_at DESC);

CREATE TABLE public.ai_draft_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ai_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_md text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','approved','rejected','applied')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_draft_outputs_status ON public.ai_draft_outputs (status, created_at DESC);

-- RLS: operator-only read/review. Workers use service role through edge functions.
ALTER TABLE public.ai_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_job_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_draft_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read workers" ON public.ai_workers FOR SELECT
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operators write workers" ON public.ai_workers FOR ALL
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "operators read jobs" ON public.ai_jobs FOR SELECT
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operators write jobs" ON public.ai_jobs FOR ALL
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "operators read results" ON public.ai_job_results FOR SELECT
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "operators read drafts" ON public.ai_draft_outputs FOR SELECT
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operators update drafts" ON public.ai_draft_outputs FOR UPDATE
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

-- updated_at trigger
CREATE TRIGGER trg_ai_jobs_updated_at BEFORE UPDATE ON public.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_draft_outputs;

-- Reclaim stale claimed jobs (mirrors reclaim_stale_night_jobs pattern).
CREATE OR REPLACE FUNCTION public.reclaim_stale_ai_jobs(_stale_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - (_stale_minutes || ' minutes')::interval;
  requeued int := 0;
  blocked int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'operator')
       OR public.has_role(auth.uid(),'admin')
       OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH stale AS (
    SELECT id, attempts, max_retries
    FROM public.ai_jobs
    WHERE status = 'claimed'
      AND coalesce(heartbeat_at, claimed_at) < cutoff
    FOR UPDATE SKIP LOCKED
  ),
  to_block AS (
    UPDATE public.ai_jobs j
       SET status = 'auto_blocked',
           last_error = coalesce(j.last_error,'') || ' [reclaim: max_retries exceeded]'
      FROM stale s
     WHERE j.id = s.id AND s.attempts >= s.max_retries
    RETURNING j.id
  ),
  to_requeue AS (
    UPDATE public.ai_jobs j
       SET status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           heartbeat_at = NULL,
           last_error = coalesce(j.last_error,'') || ' [reclaim: stalled worker]'
      FROM stale s
     WHERE j.id = s.id AND s.attempts < s.max_retries
    RETURNING j.id
  )
  SELECT (SELECT count(*) FROM to_requeue), (SELECT count(*) FROM to_block)
    INTO requeued, blocked;

  RETURN jsonb_build_object(
    'cutoff', cutoff,
    'requeued', requeued,
    'auto_blocked', blocked
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclaim_stale_ai_jobs(int) TO authenticated, service_role;
