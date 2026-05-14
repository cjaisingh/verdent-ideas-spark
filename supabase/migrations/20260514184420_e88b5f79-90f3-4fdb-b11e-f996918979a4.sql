CREATE OR REPLACE FUNCTION public.auto_link_finding_to_action(_finding_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.sentinel_findings%ROWTYPE;
  target_action uuid;
BEGIN
  SELECT * INTO f FROM public.sentinel_findings WHERE id = _finding_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT da.id INTO target_action
    FROM public.discussion_actions da
    JOIN public.discussion_action_findings daf ON daf.action_id = da.id
    JOIN public.sentinel_findings sf ON sf.id = daf.finding_id
   WHERE da.status NOT IN ('done','cancelled')
     AND sf.kind = f.kind
     AND coalesce(sf.subject_ref->>'job','') = coalesce(f.subject_ref->>'job','')
     AND sf.id <> f.id
   ORDER BY daf.created_at DESC
   LIMIT 1;

  IF target_action IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.discussion_action_findings (action_id, finding_id, linked_by_label, note)
    VALUES (target_action, _finding_id, 'sentinel-tick', 'auto-linked: matching kind+subject')
    ON CONFLICT (action_id, finding_id) DO NOTHING;

  RETURN target_action;
END $$;

INSERT INTO public.retention_settings (table_name, retention_days)
  VALUES ('sentinel_triage_activity', 90)
  ON CONFLICT (table_name) DO UPDATE SET retention_days = EXCLUDED.retention_days;