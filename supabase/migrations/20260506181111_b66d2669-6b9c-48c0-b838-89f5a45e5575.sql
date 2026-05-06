
CREATE TYPE public.roadmap_status AS ENUM ('planned','active','done','paused');
CREATE TYPE public.roadmap_task_status AS ENUM ('todo','in_progress','blocked','review','done','wont_do');
CREATE TYPE public.roadmap_comment_kind AS ENUM ('comment','question','decision');

CREATE TABLE public.roadmap_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  "order" int NOT NULL DEFAULT 0,
  status public.roadmap_status NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roadmap_sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES public.roadmap_phases(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  goal text,
  "order" int NOT NULL DEFAULT 0,
  status public.roadmap_status NOT NULL DEFAULT 'planned',
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phase_id, key)
);

CREATE TABLE public.roadmap_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES public.roadmap_sprints(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  description text,
  acceptance text,
  status public.roadmap_task_status NOT NULL DEFAULT 'todo',
  owner text,
  module text,
  capability_id text,
  blocked_by uuid[] NOT NULL DEFAULT '{}',
  "order" int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sprint_id, key)
);

CREATE TABLE public.roadmap_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL,
  kind public.roadmap_comment_kind NOT NULL DEFAULT 'comment',
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sprints_phase ON public.roadmap_sprints(phase_id);
CREATE INDEX idx_tasks_sprint ON public.roadmap_tasks(sprint_id);
CREATE INDEX idx_comments_task ON public.roadmap_comments(task_id);

ALTER TABLE public.roadmap_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read phases" ON public.roadmap_phases FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "operators write phases" ON public.roadmap_phases FOR ALL TO authenticated USING (has_role(auth.uid(),'operator')) WITH CHECK (has_role(auth.uid(),'operator'));

CREATE POLICY "operators read sprints" ON public.roadmap_sprints FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "operators write sprints" ON public.roadmap_sprints FOR ALL TO authenticated USING (has_role(auth.uid(),'operator')) WITH CHECK (has_role(auth.uid(),'operator'));

CREATE POLICY "operators read tasks" ON public.roadmap_tasks FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "operators write tasks" ON public.roadmap_tasks FOR ALL TO authenticated USING (has_role(auth.uid(),'operator')) WITH CHECK (has_role(auth.uid(),'operator'));

CREATE POLICY "operators read comments" ON public.roadmap_comments FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "operators write comments" ON public.roadmap_comments FOR ALL TO authenticated USING (has_role(auth.uid(),'operator')) WITH CHECK (has_role(auth.uid(),'operator'));

CREATE TRIGGER trg_phases_updated BEFORE UPDATE ON public.roadmap_phases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sprints_updated BEFORE UPDATE ON public.roadmap_sprints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.roadmap_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_phases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_sprints;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_comments;
