
-- Enums
CREATE TYPE public.app_role AS ENUM ('operator', 'admin');
CREATE TYPE public.okr_kind AS ENUM ('objective', 'key_result');
CREATE TYPE public.okr_status AS ENUM ('draft', 'active', 'superseded', 'achieved', 'abandoned');
CREATE TYPE public.okr_creator AS ENUM ('discovery_ai', 'awip', 'human');
CREATE TYPE public.capability_status AS ENUM ('available', 'planned', 'experimental', 'deprecated');

-- Tenants
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles (separate table per security best practice)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- OKR nodes
CREATE TABLE public.okr_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.okr_nodes(id) ON DELETE CASCADE,
  kind public.okr_kind NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status public.okr_status NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  superseded_by UUID REFERENCES public.okr_nodes(id),
  spawned_from_reason TEXT,
  created_by public.okr_creator NOT NULL DEFAULT 'human',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_okr_nodes_tenant ON public.okr_nodes(tenant_id);
CREATE INDEX idx_okr_nodes_parent ON public.okr_nodes(parent_id);

-- OKR measurements (one row per KR)
CREATE TABLE public.okr_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_node_id UUID NOT NULL UNIQUE REFERENCES public.okr_nodes(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  baseline NUMERIC,
  target NUMERIC,
  unit TEXT,
  cadence TEXT,
  attribution_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_capabilities TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OKR event log
CREATE TABLE public.okr_node_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  okr_node_id UUID NOT NULL REFERENCES public.okr_nodes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- created, spawned, superseded, status_changed, ingested
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_okr_events_tenant ON public.okr_node_events(tenant_id, created_at DESC);

-- Capabilities
CREATE TABLE public.capabilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status public.capability_status NOT NULL DEFAULT 'planned',
  version TEXT NOT NULL DEFAULT '0.1.0',
  inputs_required JSONB NOT NULL DEFAULT '[]'::jsonb,
  outputs_provided JSONB NOT NULL DEFAULT '[]'::jsonb,
  owning_module TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.capability_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id TEXT NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
  connector_name TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE public.capability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- registered, status_changed, version_bumped, deprecated
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_capability_events_created ON public.capability_events(created_at DESC);

-- Idempotency
CREATE TABLE public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  scope TEXT NOT NULL, -- e.g. 'okr_ingest'
  tenant_id UUID,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);

-- Enable RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_node_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Operator policies: operators can read everything; writes to OKRs/capabilities go through edge functions (service role bypasses RLS)
CREATE POLICY "operators read tenants" ON public.tenants FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators write tenants" ON public.tenants FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'operator')) WITH CHECK (public.has_role(auth.uid(), 'operator'));

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "operators read okr_nodes" ON public.okr_nodes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators read okr_measurements" ON public.okr_measurements FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators read okr_events" ON public.okr_node_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators read capabilities" ON public.capabilities FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators read capability_connectors" ON public.capability_connectors FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators read capability_events" ON public.capability_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));

-- Seed capabilities
INSERT INTO public.capabilities (id, name, description, status, version, owning_module) VALUES
  ('desk_utilisation_measurement', 'Desk utilisation measurement', 'Measure desk occupancy from sensor or badge data', 'planned', '0.1.0', NULL),
  ('meeting_room_utilisation', 'Meeting room utilisation', 'Track meeting room booking vs actual use', 'planned', '0.1.0', NULL),
  ('lease_summary_extraction', 'Lease summary extraction', 'Extract key terms from lease documents', 'experimental', '0.1.0', NULL),
  ('document_qa', 'Document Q&A', 'Answer questions over a corpus of client documents', 'planned', '0.1.0', NULL),
  ('badge_swipe_ingest', 'Badge swipe ingestion', 'Ingest access control badge swipe events', 'planned', '0.1.0', NULL),
  ('headcount_forecast', 'Headcount forecast', 'Forecast headcount by team and location', 'planned', '0.1.0', NULL),
  ('space_demand_modelling', 'Space demand modelling', 'Model future space demand from headcount + utilisation', 'planned', '0.1.0', NULL),
  ('energy_consumption_baseline', 'Energy consumption baseline', 'Establish baseline energy use per building', 'planned', '0.1.0', NULL),
  ('cleaning_demand_signal', 'Cleaning demand signal', 'Derive cleaning frequency from utilisation patterns', 'planned', '0.1.0', NULL),
  ('cost_per_seat_attribution', 'Cost per seat attribution', 'Attribute property costs to seats and teams', 'planned', '0.1.0', NULL),
  ('engagement_kickoff_capture', 'Engagement kickoff capture', 'Capture findings from Discovery AI interviews', 'available', '0.1.0', 'discovery_ai'),
  ('okr_authoring', 'OKR authoring', 'Create and version OKR trees in AWIP Core', 'available', '0.1.0', 'awip_core');

INSERT INTO public.capability_events (capability_id, event_type, payload, actor)
SELECT id, 'registered', jsonb_build_object('seed', true), 'system' FROM public.capabilities;

-- Auto-grant operator role to first user (bootstrap)
CREATE OR REPLACE FUNCTION public.bootstrap_first_operator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'operator') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operator');
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_bootstrap
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_operator();
