
-- s5.2 closeout: composite scorer, configurable thresholds, RLS subtree helper, audit trail

-- ============================================================================
-- t2: resolver_thresholds + audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.resolver_thresholds (
  band            text PRIMARY KEY,
  min_score       numeric(5,4) NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT resolver_thresholds_band_chk CHECK (band IN ('auto_bind','conflict','no_match')),
  CONSTRAINT resolver_thresholds_score_chk CHECK (min_score >= 0 AND min_score <= 1)
);

GRANT SELECT ON public.resolver_thresholds TO authenticated;
GRANT ALL ON public.resolver_thresholds TO service_role;

ALTER TABLE public.resolver_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resolver_thresholds operator read"
  ON public.resolver_thresholds FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

-- Writes go through awip-api with service-role key; no direct write policy.

CREATE TABLE IF NOT EXISTS public.resolver_thresholds_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band            text NOT NULL,
  before_score    numeric(5,4),
  after_score     numeric(5,4) NOT NULL,
  actor           uuid,
  actor_label     text,
  reason          text NOT NULL,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resolver_thresholds_audit_reason_chk CHECK (length(reason) >= 8)
);

GRANT SELECT ON public.resolver_thresholds_audit TO authenticated;
GRANT ALL ON public.resolver_thresholds_audit TO service_role;

ALTER TABLE public.resolver_thresholds_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resolver_thresholds_audit operator read"
  ON public.resolver_thresholds_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_resolver_thresholds_audit_band_created
  ON public.resolver_thresholds_audit(band, created_at DESC);

-- Seed default thresholds (monotone: auto_bind > conflict > no_match)
INSERT INTO public.resolver_thresholds(band, min_score) VALUES
  ('auto_bind', 0.95),
  ('conflict',  0.60),
  ('no_match',  0.00)
ON CONFLICT (band) DO NOTHING;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.resolver_thresholds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.resolver_thresholds_audit;

-- ============================================================================
-- resolver_decisions: snapshot thresholds for replay/audit
-- ============================================================================
ALTER TABLE public.resolver_decisions
  ADD COLUMN IF NOT EXISTS band_thresholds_snapshot jsonb;

ALTER TABLE public.resolver_decisions
  ADD COLUMN IF NOT EXISTS matched_kinds text[];

-- ============================================================================
-- t1: composite scorer — replace resolve_entity body
-- Strategy:
--   Pass 1 (authoritative short-circuit): any descriptor with weight >= 0.95
--          matching an alias → return immediately, confidence = 1.0
--   Pass 2 (composite): aggregate matched weights per candidate node, pick
--          the highest summed score (capped at 1.0). Returns matched_kinds[]
--          so caller can audit which descriptors drove the binding.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_entity(_tenant_id uuid, _descriptors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _winner uuid;
  _score numeric;
  _candidate_count integer;
  _matched_kinds text[];
  _d jsonb;
  _kind alias_descriptor_kind;
  _norm text;
BEGIN
  IF _descriptors IS NULL OR jsonb_array_length(_descriptors) = 0 THEN
    RETURN jsonb_build_object(
      'winner_node_id', NULL, 'strategy', 'no_descriptors',
      'confidence', 0, 'candidate_count', 0, 'matched_kinds', '[]'::jsonb
    );
  END IF;

  -- Pass 1: authoritative short-circuit
  FOR _d IN SELECT * FROM jsonb_array_elements(_descriptors) LOOP
    _kind := (_d->>'kind')::alias_descriptor_kind;
    _norm := lower(trim(_d->>'value'));

    SELECT a.node_id INTO _winner
    FROM public.tenant_node_aliases a
    JOIN public.resolver_descriptor_weights w ON w.kind = a.kind
    WHERE a.tenant_id = _tenant_id
      AND a.kind = _kind
      AND a.revoked_at IS NULL
      AND a.hard_revoked = false
      AND (a.normalised = _norm OR lower(a.value) = _norm)
      AND w.weight >= 0.95
    LIMIT 1;

    IF _winner IS NOT NULL THEN
      RETURN jsonb_build_object(
        'winner_node_id', _winner,
        'strategy', 'exact_authoritative',
        'confidence', 1.0,
        'candidate_count', 1,
        'matched_kind', _kind,
        'matched_kinds', jsonb_build_array(_kind::text),
        'authoritative_hit', true
      );
    END IF;
  END LOOP;

  -- Pass 2: composite score across all matched descriptors per candidate
  WITH descs AS (
    SELECT (e->>'kind')::alias_descriptor_kind AS kind,
           lower(trim(e->>'value')) AS norm
    FROM jsonb_array_elements(_descriptors) e
  ),
  matches AS (
    SELECT DISTINCT a.node_id, a.kind, w.weight
    FROM public.tenant_node_aliases a
    JOIN public.resolver_descriptor_weights w ON w.kind = a.kind
    JOIN descs d ON d.kind = a.kind
                AND (a.normalised = d.norm OR lower(a.value) = d.norm)
    WHERE a.tenant_id = _tenant_id
      AND a.revoked_at IS NULL
      AND a.hard_revoked = false
  ),
  scored AS (
    SELECT node_id,
           LEAST(1.0, SUM(weight))::numeric AS score,
           array_agg(DISTINCT kind::text ORDER BY kind::text) AS kinds
    FROM matches
    GROUP BY node_id
  )
  SELECT node_id, score, kinds, (SELECT count(*) FROM scored)
    INTO _winner, _score, _matched_kinds, _candidate_count
  FROM scored
  ORDER BY score DESC, node_id ASC
  LIMIT 1;

  IF _winner IS NULL THEN
    RETURN jsonb_build_object(
      'winner_node_id', NULL, 'strategy', 'no_match',
      'confidence', 0, 'candidate_count', 0, 'matched_kinds', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'winner_node_id', _winner,
    'strategy', CASE WHEN array_length(_matched_kinds,1) > 1 THEN 'composite' ELSE 'exact_alias' END,
    'confidence', _score,
    'candidate_count', _candidate_count,
    'matched_kinds', to_jsonb(_matched_kinds),
    'authoritative_hit', false
  );
END;
$function$;

-- ============================================================================
-- resolve_entity_logged: read thresholds + snapshot in decision row
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_entity_logged(
  _tenant_id uuid,
  _descriptors jsonb,
  _request_id text DEFAULT NULL,
  _actor_label text DEFAULT 'resolver'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _start timestamptz := clock_timestamp();
  _result jsonb;
  _latency integer;
  _conf numeric;
  _band text;
  _thresholds jsonb;
  _auto numeric;
  _conflict numeric;
  _matched_kinds text[];
BEGIN
  _result := public.resolve_entity(_tenant_id, _descriptors);
  _latency := EXTRACT(MILLISECONDS FROM clock_timestamp() - _start)::integer;
  _conf := COALESCE((_result->>'confidence')::numeric, 0);

  SELECT jsonb_object_agg(band, min_score) INTO _thresholds
  FROM public.resolver_thresholds;

  _auto := COALESCE((_thresholds->>'auto_bind')::numeric, 0.95);
  _conflict := COALESCE((_thresholds->>'conflict')::numeric, 0.60);

  _band := CASE
    WHEN _conf >= _auto THEN 'auto_bind'
    WHEN _conf >= _conflict THEN 'conflict'
    ELSE 'no_match'
  END;

  SELECT ARRAY(SELECT jsonb_array_elements_text(_result->'matched_kinds'))
    INTO _matched_kinds;

  INSERT INTO public.resolver_decisions
    (request_id, tenant_id, descriptors, candidate_count, winning_node_id,
     match_source, score, confidence_band, authoritative_hit,
     embedding_hint_used, latency_ms, actor_label,
     band_thresholds_snapshot, matched_kinds)
  VALUES (
    _request_id, _tenant_id, _descriptors,
    COALESCE((_result->>'candidate_count')::integer, 0),
    NULLIF(_result->>'winner_node_id','')::uuid,
    _result->>'strategy',
    _conf, _band,
    COALESCE((_result->>'authoritative_hit')::boolean, false),
    false, _latency, _actor_label,
    _thresholds, _matched_kinds
  );

  IF (_result->>'winner_node_id') IS NOT NULL THEN
    INSERT INTO public.tenant_node_events
      (subject_type, subject_id, event_type, actor, after)
    VALUES (
      'tenant_node',
      (_result->>'winner_node_id')::uuid,
      'resolve',
      NULL,
      jsonb_build_object(
        'request_id', _request_id,
        'confidence', _conf,
        'band', _band,
        'strategy', _result->>'strategy',
        'matched_kinds', _matched_kinds,
        'thresholds', _thresholds
      )
    );
  END IF;

  RETURN _result || jsonb_build_object('band', _band, 'thresholds', _thresholds);
END;
$function$;

-- ============================================================================
-- t4: is_in_tenant_subtree(node_id) — universal RLS predicate
-- Derives the caller's tenant root from JWT (claim 'tenant_id') and checks
-- whether _node_id sits at-or-under that root via ancestry_ids @>.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_in_tenant_subtree(_node_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _claim_tenant uuid;
  _node_tenant uuid;
  _node_ancestry uuid[];
BEGIN
  IF _node_id IS NULL THEN RETURN false; END IF;

  SELECT tenant_id, ancestry_ids INTO _node_tenant, _node_ancestry
  FROM public.tenant_nodes WHERE id = _node_id;
  IF _node_tenant IS NULL THEN RETURN false; END IF;

  -- Operator/admin: full visibility
  IF public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin') THEN
    RETURN true;
  END IF;

  -- Service-token / module caller: tenant_id claim must match the node's tenant
  BEGIN
    _claim_tenant := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'tenant_id','')::uuid;
  EXCEPTION WHEN others THEN
    _claim_tenant := NULL;
  END;

  IF _claim_tenant IS NULL THEN RETURN false; END IF;

  RETURN _node_tenant = _claim_tenant
      OR _claim_tenant = ANY(_node_ancestry);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.is_in_tenant_subtree(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_in_tenant_subtree(uuid) IS
  's5.2/t4 universal RLS predicate: caller can see node iff operator/admin OR JWT tenant_id claim matches node.tenant_id or is in node.ancestry_ids. Use in RLS policies on any tenanted table: USING (public.is_in_tenant_subtree(tenant_node_id)).';
