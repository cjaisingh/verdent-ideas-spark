-- Sentinel triage activity log: fires when an action accumulates 2+ sentinel-finding links

-- Junction table: discussion_action ↔ sentinel_finding
CREATE TABLE IF NOT EXISTS public.discussion_action_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.discussion_actions(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES public.sentinel_findings(id) ON DELETE CASCADE,
  linked_by uuid,
  linked_by_label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, finding_id)
);
CREATE INDEX IF NOT EXISTS idx_daf_action ON public.discussion_action_findings(action_id);
CREATE INDEX IF NOT EXISTS idx_daf_finding ON public.discussion_action_findings(finding_id);

ALTER TABLE public.discussion_action_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read daf" ON public.discussion_action_findings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));
CREATE POLICY "operators insert daf" ON public.discussion_action_findings
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));
CREATE POLICY "operators delete daf" ON public.discussion_action_findings
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.discussion_action_findings;

-- Activity log: one row per "group formed / grew" event
CREATE TABLE IF NOT EXISTS public.sentinel_triage_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.discussion_actions(id) ON DELETE CASCADE,
  action_short_num integer,
  action_title text,
  event_kind text NOT NULL,        -- 'group_formed' (count hit 2) | 'group_grew' (count >2)
  finding_count integer NOT NULL,
  finding_ids uuid[] NOT NULL DEFAULT '{}',
  triggered_by uuid,
  triggered_by_label text,
  acknowledged_by uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sta_created ON public.sentinel_triage_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sta_action ON public.sentinel_triage_activity(action_id);

ALTER TABLE public.sentinel_triage_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read sta" ON public.sentinel_triage_activity
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));
CREATE POLICY "no client write sta" ON public.sentinel_triage_activity
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.sentinel_triage_activity;

-- Trigger: on link insert, if action now has >=2 findings, log group_formed (first time) or group_grew
CREATE OR REPLACE FUNCTION public.log_sentinel_triage_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cnt integer;
  ids uuid[];
  uid uuid := auth.uid();
  label text;
  action_row public.discussion_actions%ROWTYPE;
  prior_event boolean;
BEGIN
  SELECT count(*), array_agg(finding_id ORDER BY created_at)
    INTO cnt, ids
    FROM public.discussion_action_findings
   WHERE action_id = NEW.action_id;

  IF cnt < 2 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO action_row FROM public.discussion_actions WHERE id = NEW.action_id;

  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := coalesce(NEW.linked_by_label, 'system'); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sentinel_triage_activity WHERE action_id = NEW.action_id
  ) INTO prior_event;

  INSERT INTO public.sentinel_triage_activity
    (action_id, action_short_num, action_title, event_kind, finding_count, finding_ids,
     triggered_by, triggered_by_label)
  VALUES
    (NEW.action_id, action_row.short_num, action_row.title,
     CASE WHEN prior_event THEN 'group_grew' ELSE 'group_formed' END,
     cnt, ids, uid, label);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_sentinel_triage_group ON public.discussion_action_findings;
CREATE TRIGGER trg_log_sentinel_triage_group
  AFTER INSERT ON public.discussion_action_findings
  FOR EACH ROW EXECUTE FUNCTION public.log_sentinel_triage_group();

-- Acknowledge RPC
CREATE OR REPLACE FUNCTION public.acknowledge_triage_activity(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT (has_role(uid,'operator') OR has_role(uid,'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.sentinel_triage_activity
     SET acknowledged_by = (
       SELECT array_agg(DISTINCT x) FROM unnest(acknowledged_by || ARRAY[uid]) x
     )
   WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.acknowledge_all_triage_activity()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); n integer;
BEGIN
  IF NOT (has_role(uid,'operator') OR has_role(uid,'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  WITH upd AS (
    UPDATE public.sentinel_triage_activity
       SET acknowledged_by = (
         SELECT array_agg(DISTINCT x) FROM unnest(acknowledged_by || ARRAY[uid]) x
       )
     WHERE NOT (uid = ANY(acknowledged_by))
     RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN coalesce(n,0);
END $$;

-- Unacked count for sidebar badge (per current user)
CREATE OR REPLACE FUNCTION public.sentinel_triage_unacked_count()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int FROM public.sentinel_triage_activity
   WHERE NOT (coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) = ANY(acknowledged_by));
$$;