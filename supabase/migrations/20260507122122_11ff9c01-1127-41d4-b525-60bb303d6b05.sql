-- Persistent, redacted audit log for the db-explorer edge function so the
-- operator UI can filter and search past activity. Console line stays as-is.
CREATE TABLE IF NOT EXISTS public.db_explorer_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  user_id uuid,
  action text,
  "table" text,
  "limit" integer,
  "offset" integer,
  status integer NOT NULL,
  result_count integer,
  duration_ms integer,
  error_code text,
  rejected boolean NOT NULL DEFAULT false,
  rejection_reason text,
  requested jsonb
);

CREATE INDEX IF NOT EXISTS idx_db_explorer_audit_created_at ON public.db_explorer_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_explorer_audit_request_id ON public.db_explorer_audit (request_id);
CREATE INDEX IF NOT EXISTS idx_db_explorer_audit_action ON public.db_explorer_audit (action);
CREATE INDEX IF NOT EXISTS idx_db_explorer_audit_table ON public.db_explorer_audit ("table");
CREATE INDEX IF NOT EXISTS idx_db_explorer_audit_status ON public.db_explorer_audit (status);

ALTER TABLE public.db_explorer_audit ENABLE ROW LEVEL SECURITY;

-- Operators can read all audit rows.
CREATE POLICY "operators read audit" ON public.db_explorer_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'));

-- No client INSERT/UPDATE/DELETE — only the edge function (service role) writes.

-- Surface in realtime so the UI can stream new entries.
ALTER PUBLICATION supabase_realtime ADD TABLE public.db_explorer_audit;