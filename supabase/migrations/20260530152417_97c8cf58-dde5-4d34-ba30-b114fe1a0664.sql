-- Widen observability_registry.surface_kind to allow 'rpc' (e.g. resolve_entity_logged)
ALTER TABLE public.observability_registry
  DROP CONSTRAINT observability_registry_surface_kind_check;

ALTER TABLE public.observability_registry
  ADD CONSTRAINT observability_registry_surface_kind_check
  CHECK (surface_kind = ANY (ARRAY['cron'::text, 'edge_fn'::text, 'table'::text, 'agent'::text, 'rpc'::text]));