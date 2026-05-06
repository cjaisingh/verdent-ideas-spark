ALTER TABLE public.approval_queue
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS requesting_module text,
  ADD COLUMN IF NOT EXISTS capability_id text,
  ADD COLUMN IF NOT EXISTS callback_url text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS approval_queue_module_idem_uq
  ON public.approval_queue (requesting_module, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS approval_queue_status_module_idx
  ON public.approval_queue (status, requesting_module);

CREATE INDEX IF NOT EXISTS approval_queue_capability_idx
  ON public.approval_queue (capability_id);