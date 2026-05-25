
-- Phase 6 s6.1/t0 — Retrieval-shape declaration registry
CREATE TABLE IF NOT EXISTS public.retrieval_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer text NOT NULL UNIQUE,
  consumer_kind text NOT NULL CHECK (consumer_kind IN ('edge_fn','cron','ui_route','agent_loop')),
  shape text NOT NULL CHECK (shape IN ('prose','hierarchical-doc','tabular','graph','relational','time-series')),
  store text NOT NULL,
  primary_key text NOT NULL,
  token_budget integer NOT NULL CHECK (token_budget > 0),
  freshness_window text NOT NULL,
  fallback text NOT NULL,
  declared_by text NOT NULL,
  status text NOT NULL DEFAULT 'declared' CHECK (status IN ('declared','implemented','deprecated')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retrieval_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operator reads retrieval_contracts" ON public.retrieval_contracts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "admin writes retrieval_contracts" ON public.retrieval_contracts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_retrieval_contracts_touch
  BEFORE UPDATE ON public.retrieval_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.retrieval_contracts;

-- Seed the 6 highest-traffic surfaces
INSERT INTO public.retrieval_contracts
  (consumer, consumer_kind, shape, store, primary_key, token_budget, freshness_window, fallback, declared_by, status, notes)
VALUES
  ('morning-review','cron','hierarchical-doc','postgres:public.morning_reviews','(id)',8000,'24h','plain SELECT on morning_reviews','plan:s6.1/t0','implemented','Aggregator already reads structured rows; declared to lock the shape before pgvector expansion.'),
  ('companion-cloud-chat','edge_fn','prose','postgres:public.awip_rag_chunks','(id)',4000,'7d','ollama-worker local FAISS','plan:s6.1/t0','implemented','Prose RAG over awip-reviews + docs; embeddings in pgvector.'),
  ('awip-reviews','cron','prose','github:cjaisingh/verdent-ideas-spark/docs/reviews','(path,sha)',16000,'7d','manual paste into /admin/awip-reviews','plan:s6.1/t0','implemented','Markdown reviews pulled Mon 05:30 UTC.'),
  ('sentinel-tick','cron','tabular','postgres:public.sentinel_findings','(kind,dedupe_key)',2000,'15m','direct SELECT on findings','plan:s6.1/t0','implemented','Structured findings; pure tabular shape.'),
  ('night-agent','agent_loop','graph','postgres:public.discussion_actions+discussion_action_findings','(action_id,finding_id)',6000,'8h','sequential SELECT per action','plan:s6.1/t0','implemented','Action↔finding graph traversal; junction table walks.'),
  ('claims-ingest','edge_fn','relational','postgres:public.claims+claim_events','(entity,entity_id,field,source)',2000,'1h','direct SELECT on claims','plan:s6.1/t0','implemented','W7.2 claim pipeline; precedence join against decision_authorities.');

-- Register in observability_registry so missing-watcher / stale-surface sentinel covers it
INSERT INTO public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
VALUES
  ('table','retrieval_contracts',43200,ARRAY['observability_stale_surface']::text[],'phase-6','Declarations are git-versioned; staleness > 30d means surfaces are drifting without declaration updates.','docs/retrieval-contracts.md')
ON CONFLICT DO NOTHING;
