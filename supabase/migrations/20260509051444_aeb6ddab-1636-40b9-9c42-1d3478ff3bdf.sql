
-- Workstream tracker for the in-app Plan dashboard.
CREATE TYPE public.plan_status AS ENUM ('todo','in_progress','blocked','done');

CREATE TABLE public.plan_workstreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  summary text,
  target_week int,
  sort_order int NOT NULL DEFAULT 0,
  status public.plan_status NOT NULL DEFAULT 'todo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workstream_id uuid NOT NULL REFERENCES public.plan_workstreams(id) ON DELETE CASCADE,
  title text NOT NULL,
  detail text,
  area text,
  status public.plan_status NOT NULL DEFAULT 'todo',
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plan_tasks_workstream ON public.plan_tasks (workstream_id, sort_order);
CREATE INDEX idx_plan_tasks_status ON public.plan_tasks (status);

ALTER TABLE public.plan_workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_tasks ENABLE ROW LEVEL SECURITY;

-- Read: operators + admins.
CREATE POLICY "operators read workstreams" ON public.plan_workstreams FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "operators read plan tasks" ON public.plan_tasks FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- Write: operators + admins for workstreams; admins for delete.
CREATE POLICY "operators update workstreams" ON public.plan_workstreams FOR UPDATE
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert workstreams" ON public.plan_workstreams FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete workstreams" ON public.plan_workstreams FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "operators update plan tasks" ON public.plan_tasks FOR UPDATE
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "operators insert plan tasks" ON public.plan_tasks FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete plan tasks" ON public.plan_tasks FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at triggers
CREATE TRIGGER trg_plan_workstreams_touch BEFORE UPDATE ON public.plan_workstreams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_plan_tasks_touch BEFORE UPDATE ON public.plan_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.plan_workstreams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.plan_tasks;

-- Seed the six workstreams + their initial tasks (matches .lovable/plan.md).
INSERT INTO public.plan_workstreams (slug, title, summary, target_week, sort_order, status) VALUES
  ('logger',         'Logger Agent',           'Structured edge logging, request-id propagation, frontend error capture, retention.', 1, 1, 'in_progress'),
  ('morning-review', 'Morning Review',         'Daily backlog hygiene; surfaces stuck jobs and promotion-vs-shipping drift.',         2, 2, 'todo'),
  ('sentinel',       'Sentinel Agent',         'Continuous 15-min watcher: cron silence, 5xx spikes, secret age, role grants.',       3, 3, 'todo'),
  ('lessons-loop',   'Lessons-Learned Loop',   'Weekly synthesis turning observations into durable rules (memory + findings).',       4, 4, 'todo'),
  ('deep-audit',     'Deep Audit',             'Weekly + monthly multi-dimensional audit (security, ISO27001, performance, roadmap, resilience).', 5, 5, 'todo'),
  ('doc-drift-ci',   'Doc-Drift + GitHub CI',  'Weekly doc-drift scan + CodeQL/Dependabot/gitleaks/Lighthouse/axe workflows.',        6, 6, 'todo');

-- Tasks for Logger (Week 1) — first three are already done as of this migration.
INSERT INTO public.plan_tasks (workstream_id, title, detail, area, status, sort_order)
SELECT w.id, x.title, x.detail, x.area, x.status::public.plan_status, x.sort_order
FROM public.plan_workstreams w
CROSS JOIN LATERAL (VALUES
  ('Migration: edge_request_logs + frontend_error_logs', 'Operator-read RLS, realtime, 30d retention.', 'supabase/migrations', 'done', 1),
  ('Shared logger middleware (withLogger)',              'Request-id, latency, classified error, fire-and-forget insert.', 'supabase/functions/_shared/logger.ts', 'done', 2),
  ('frontend-errors edge function',                      'Public POST endpoint; field caps; user-id hashing.', 'supabase/functions/frontend-errors', 'done', 3),
  ('App-root ErrorBoundary + capture init',              'Window error/unhandledrejection + boundary report; sendBeacon + fetch fallback.', 'src/components/ErrorBoundary.tsx, src/lib/frontend-error-capture.ts, src/main.tsx', 'done', 4),
  ('Wrap awip-api with withLogger',                      'No behavior change; adds structured logs + x-request-id echo.', 'supabase/functions/awip-api/index.ts', 'todo', 5),
  ('Wrap overnight-phase-runner with withLogger',        'Same wrapping; verify cron path still authenticates.', 'supabase/functions/overnight-phase-runner/index.ts', 'todo', 6),
  ('Wrap alerts dispatcher with withLogger',             'Capture alert send latency + classify webhook errors.', 'supabase/functions/_shared/alerts.ts callers', 'todo', 7),
  ('Admin /admin/logs page',                             'Read edge_request_logs + frontend_error_logs with filters by function/status/kind.', 'src/pages/AdminLogs.tsx', 'todo', 8)
) AS x(title, detail, area, status, sort_order)
WHERE w.slug = 'logger';

INSERT INTO public.plan_tasks (workstream_id, title, detail, area, status, sort_order)
SELECT w.id, x.title, x.detail, x.area, x.status::public.plan_status, x.sort_order
FROM public.plan_workstreams w
CROSS JOIN LATERAL (VALUES
  ('morning_reviews table',                              'Operator-only RLS, realtime, retention.', 'supabase/migrations', 'todo', 1),
  ('morning-review edge function',                       'GET ?days=7; assembles KPIs and top_actions.', 'supabase/functions/morning-review', 'todo', 2),
  ('scheduled-morning-review cron at 06:00 UTC',         'Auths with AWIP_SERVICE_TOKEN.', 'supabase cron', 'todo', 3),
  ('/morning-review page',                               'KPI strip, Stuck Jobs, Promotion Drift, Cron heartbeat, Acknowledge button.', 'src/pages/MorningReview.tsx', 'todo', 4),
  ('Mirror task→action one-click action',                'Closes JOB-1/JOB-2 class bug.', 'src/components/morning/PromotionDriftCard.tsx', 'todo', 5),
  ('docs/morning-review.md + memory entry',              'Update README + CHANGELOG.', 'docs/, mem://features/', 'todo', 6)
) AS x(title, detail, area, status, sort_order)
WHERE w.slug = 'morning-review';

INSERT INTO public.plan_tasks (workstream_id, title, detail, area, status, sort_order)
SELECT w.id, x.title, x.detail, x.area, x.status::public.plan_status, x.sort_order
FROM public.plan_workstreams w
CROSS JOIN LATERAL (VALUES
  ('sentinel_findings table',                            'Operator-only RLS, realtime.', 'supabase/migrations', 'todo', 1),
  ('sentinel-tick edge function (15-min cron)',          'Cron silence, 5xx rate, secret age, role-grant watchers.', 'supabase/functions/sentinel-tick', 'todo', 2),
  ('Sentinel status strip on /automation',               'Live findings count + last-tick timestamp.', 'src/components/AutomationPanel.tsx', 'todo', 3),
  ('Roll Sentinel findings into Morning Review',         'Cross-link with severity counts.', 'morning-review fn', 'todo', 4),
  ('docs/sentinel.md + memory entry',                    'Update README + CHANGELOG.', 'docs/, mem://features/', 'todo', 5)
) AS x(title, detail, area, status, sort_order)
WHERE w.slug = 'sentinel';

INSERT INTO public.plan_tasks (workstream_id, title, detail, area, status, sort_order)
SELECT w.id, x.title, x.detail, x.area, x.status::public.plan_status, x.sort_order
FROM public.plan_workstreams w
CROSS JOIN LATERAL (VALUES
  ('lessons table',                                      'category, severity, evidence jsonb, recommendation, status, applied_as.', 'supabase/migrations', 'todo', 1),
  ('lessons-synthesize edge function',                   'Clusters last N days from observations + findings + automation_runs.', 'supabase/functions/lessons-synthesize', 'todo', 2),
  ('scheduled-lessons-weekly cron Sunday 05:00 UTC',     '', 'supabase cron', 'todo', 3),
  ('/lessons page (extend or sibling)',                  'Cards, evidence chips, Apply / Defer / Reject.', 'src/pages/Lessons.tsx', 'todo', 4),
  ('Cross-link from /morning-review',                    '"Applied lessons this week" surface.', 'morning-review page', 'todo', 5),
  ('docs/lessons-loop.md + memory entry',                '', 'docs/, mem://features/', 'todo', 6)
) AS x(title, detail, area, status, sort_order)
WHERE w.slug = 'lessons-loop';

INSERT INTO public.plan_tasks (workstream_id, title, detail, area, status, sort_order)
SELECT w.id, x.title, x.detail, x.area, x.status::public.plan_status, x.sort_order
FROM public.plan_workstreams w
CROSS JOIN LATERAL (VALUES
  ('deep_audit_runs table',                              'scope, dimension_scores jsonb, findings jsonb, overall_score.', 'supabase/migrations', 'todo', 1),
  ('deep-audit edge function + 5 sub-modules',           'security.ts, iso27001.ts, performance.ts, roadmap.ts, resilience.ts.', 'supabase/functions/deep-audit', 'todo', 2),
  ('Weekly cron Sunday 04:00 UTC',                       '', 'supabase cron', 'todo', 3),
  ('Monthly cron 1st 04:30 UTC',                         '', 'supabase cron', 'todo', 4),
  ('/audits page',                                       'Score chips, dimension accordions, ISO27001 matrix, sparkline.', 'src/pages/Audits.tsx', 'todo', 5),
  ('Auto-promote high-sev to lessons + findings',        'Score-drop > 10 pts WoW dispatches alert.', 'deep-audit fn', 'todo', 6),
  ('docs/deep-audit.md, docs/iso27001-controls.md, memory', '', 'docs/, mem://features/', 'todo', 7)
) AS x(title, detail, area, status, sort_order)
WHERE w.slug = 'deep-audit';

INSERT INTO public.plan_tasks (workstream_id, title, detail, area, status, sort_order)
SELECT w.id, x.title, x.detail, x.area, x.status::public.plan_status, x.sort_order
FROM public.plan_workstreams w
CROSS JOIN LATERAL (VALUES
  ('doc-drift-scan weekly cron',                         'Diffs git log vs docs/, CHANGELOG, mem://features/, roadmap_tasks.', 'supabase/functions/doc-drift-scan', 'todo', 1),
  ('GitHub Actions: codeql.yml',                         'Security scan on PR + weekly.', '.github/workflows/', 'todo', 2),
  ('GitHub Actions: dependabot.yml',                     'Weekly npm + actions updates.', '.github/', 'todo', 3),
  ('GitHub Actions: gitleaks.yml',                       'Secret scanning on every push.', '.github/workflows/', 'todo', 4),
  ('GitHub Actions: lighthouse.yml',                     'Perf budget on PR.', '.github/workflows/', 'todo', 5),
  ('GitHub Actions: axe.yml',                            'Accessibility check on PR.', '.github/workflows/', 'todo', 6),
  ('GitHub Actions: lint-and-typecheck.yml',             'Required check on PR.', '.github/workflows/', 'todo', 7),
  ('Branch protection on main (operator action)',        'Doc the steps; require PR + passing checks.', 'docs/ci-cd.md', 'todo', 8),
  ('docs/ci-cd.md + memory entry',                       '', 'docs/, mem://preferences/', 'todo', 9)
) AS x(title, detail, area, status, sort_order)
WHERE w.slug = 'doc-drift-ci';
