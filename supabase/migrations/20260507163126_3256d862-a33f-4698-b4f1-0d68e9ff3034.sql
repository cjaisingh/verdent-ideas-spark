-- Copilot user profile
CREATE TABLE public.copilot_profiles (
  user_id uuid PRIMARY KEY,
  display_name text,
  title text,
  pronouns text,
  timezone text NOT NULL DEFAULT 'UTC',
  language text NOT NULL DEFAULT 'en',
  default_agent_id uuid REFERENCES public.copilot_agents(id) ON DELETE SET NULL,
  verbosity text NOT NULL DEFAULT 'normal' CHECK (verbosity IN ('terse','normal','verbose')),
  context_notes text,
  -- Self-managed narrowing (intersected with role + agent scope at call time)
  narrowed_capability_ids text[] NOT NULL DEFAULT '{}',
  narrowed_tables text[] NOT NULL DEFAULT '{}',
  narrowed_max_risk text NOT NULL DEFAULT 'high' CHECK (narrowed_max_risk IN ('low','medium','high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self or admin read copilot_profiles"
  ON public.copilot_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "self or admin insert copilot_profiles"
  ON public.copilot_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "self or admin update copilot_profiles"
  ON public.copilot_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin delete copilot_profiles"
  ON public.copilot_profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER copilot_profiles_updated_at
  BEFORE UPDATE ON public.copilot_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create on signup
CREATE OR REPLACE FUNCTION public.bootstrap_copilot_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.copilot_profiles (user_id, display_name)
    VALUES (NEW.id, split_part(NEW.email, '@', 1))
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_copilot_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_copilot_profile();

-- Backfill for existing users
INSERT INTO public.copilot_profiles (user_id, display_name)
  SELECT id, split_part(email, '@', 1) FROM auth.users
  ON CONFLICT (user_id) DO NOTHING;