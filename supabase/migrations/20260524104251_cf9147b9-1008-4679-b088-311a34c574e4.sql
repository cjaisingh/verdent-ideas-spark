
-- Phase 5: resolver core (s5.1/t3, s5.2/t1+t2, s5.2/t5 reuse existing table)

CREATE TABLE IF NOT EXISTS public.resolver_descriptor_weights (
  kind public.alias_descriptor_kind PRIMARY KEY,
  weight numeric NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 1),
  min_confidence numeric NOT NULL DEFAULT 0.7 CHECK (min_confidence >= 0 AND min_confidence <= 1),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resolver_descriptor_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rdw operator read" ON public.resolver_descriptor_weights;
CREATE POLICY "rdw operator read"
  ON public.resolver_descriptor_weights FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

DROP POLICY IF EXISTS "rdw admin write" ON public.resolver_descriptor_weights;
CREATE POLICY "rdw admin write"
  ON public.resolver_descriptor_weights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.resolver_descriptor_weights (kind, weight, min_confidence, notes) VALUES
  ('asset_code',    1.00, 0.95, 'Operator-issued unique code'),
  ('bim_ifc_guid',  1.00, 0.99, 'Globally unique IFC GUID'),
  ('os_uprn',       1.00, 0.99, 'Ordnance Survey UPRN'),
  ('rics_id',       0.95, 0.90, 'RICS reference'),
  ('sap_floc',      0.95, 0.90, 'SAP functional location'),
  ('postcode',      0.70, 0.75, 'Coarse — usually combined with name/address'),
  ('address',       0.75, 0.75, 'Normalised free-text address'),
  ('name',          0.60, 0.70, 'Display name — high collision risk'),
  ('other',         0.50, 0.70, 'Catch-all descriptor')
ON CONFLICT (kind) DO NOTHING;

-- resolve_entity() — s5.1/t3
CREATE OR REPLACE FUNCTION public.resolve_entity(
  _tenant_id uuid,
  _descriptors jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _winner uuid;
  _confidence numeric;
  _d jsonb;
  _kind alias_descriptor_kind;
  _norm text;
BEGIN
  IF _descriptors IS NULL OR jsonb_array_length(_descriptors) = 0 THEN
    RETURN jsonb_build_object(
      'winner_node_id', NULL, 'strategy', 'no_descriptors',
      'confidence', 0, 'candidate_count', 0
    );
  END IF;

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
        'winner_node_id', _winner, 'strategy', 'exact_authoritative',
        'confidence', 1.0, 'candidate_count', 1, 'matched_kind', _kind,
        'authoritative_hit', true
      );
    END IF;
  END LOOP;

  FOR _d IN SELECT * FROM jsonb_array_elements(_descriptors) LOOP
    _kind := (_d->>'kind')::alias_descriptor_kind;
    _norm := lower(trim(_d->>'value'));

    SELECT a.node_id, w.weight
      INTO _winner, _confidence
    FROM public.tenant_node_aliases a
    JOIN public.resolver_descriptor_weights w ON w.kind = a.kind
    WHERE a.tenant_id = _tenant_id
      AND a.kind = _kind
      AND a.revoked_at IS NULL
      AND a.hard_revoked = false
      AND (a.normalised = _norm OR lower(a.value) = _norm)
    LIMIT 1;

    IF _winner IS NOT NULL THEN
      RETURN jsonb_build_object(
        'winner_node_id', _winner, 'strategy', 'exact_alias',
        'confidence', _confidence, 'candidate_count', 1, 'matched_kind', _kind,
        'authoritative_hit', false
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'winner_node_id', NULL, 'strategy', 'no_match',
    'confidence', 0, 'candidate_count', 0, 'authoritative_hit', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_entity(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_entity(uuid, jsonb) TO authenticated;

-- Logged wrapper — writes resolver_decisions (existing schema) + tenant_node_events
CREATE OR REPLACE FUNCTION public.resolve_entity_logged(
  _tenant_id uuid,
  _descriptors jsonb,
  _request_id text DEFAULT NULL,
  _actor_label text DEFAULT 'resolver'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz := clock_timestamp();
  _result jsonb;
  _latency integer;
  _conf numeric;
  _band text;
BEGIN
  _result := public.resolve_entity(_tenant_id, _descriptors);
  _latency := EXTRACT(MILLISECONDS FROM clock_timestamp() - _start)::integer;
  _conf := (_result->>'confidence')::numeric;
  _band := CASE
    WHEN _conf >= 0.95 THEN 'high'
    WHEN _conf >= 0.75 THEN 'medium'
    WHEN _conf > 0    THEN 'low'
    ELSE 'none'
  END;

  INSERT INTO public.resolver_decisions
    (request_id, tenant_id, descriptors, candidate_count, winning_node_id,
     match_source, score, confidence_band, authoritative_hit,
     embedding_hint_used, latency_ms, actor_label)
  VALUES (
    _request_id, _tenant_id, _descriptors,
    (_result->>'candidate_count')::integer,
    NULLIF(_result->>'winner_node_id','')::uuid,
    _result->>'strategy',
    _conf, _band,
    COALESCE((_result->>'authoritative_hit')::boolean, false),
    false, _latency, _actor_label
  );

  IF (_result->>'winner_node_id') IS NOT NULL THEN
    INSERT INTO public.tenant_node_events
      (subject_type, subject_id, event_type, actor, after)
    VALUES (
      'tenant_node',
      (_result->>'winner_node_id')::uuid,
      'resolve', _actor_label,
      _result || jsonb_build_object('latency_ms', _latency, 'request_id', _request_id)
    );
  END IF;

  RETURN _result || jsonb_build_object('latency_ms', _latency, 'confidence_band', _band);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_entity_logged(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_entity_logged(uuid, jsonb, text, text) TO authenticated;
