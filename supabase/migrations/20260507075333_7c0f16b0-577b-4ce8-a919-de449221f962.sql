
-- Phase 2 sprint shell for s2.6 (find phase-2 id)
WITH p2 AS (SELECT id FROM public.roadmap_phases WHERE key = 'phase-2')
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT p2.id, 's2.6', 'Loop-task triage + promotion',
       'Promote outcome-shaped loop tasks to notebook; snapshot full loop into work_log.',
       6, 'planned'
FROM p2
WHERE NOT EXISTS (SELECT 1 FROM public.roadmap_sprints WHERE key = 's2.6');

-- New phases
INSERT INTO public.roadmap_phases (key, title, summary, "order", status) VALUES
  ('phase-5',  'Entity & Tenant Resolution',  'Canonical entity model, alias resolver, tenant_node graph. Foundation for ingest.', 5,  'planned'),
  ('phase-6',  'Ingest & Canonicalisation',   'Source adapters, conflict detection, supersede semantics, idempotent writes.', 6,  'planned'),
  ('phase-6b', 'Ingest Observability',        'Per-source dashboards, conflict review UI, replay. Splits cleanly from Phase 6 build-out.', 7,  'planned'),
  ('phase-7',  'Connector Marketplace',       'Third-party capability connectors, manifest validation, install/uninstall flow. (Phase 8 reserved for OKR-driven slot once Phase 4 produces signal.)', 8,  'planned'),
  ('phase-9',  'Multi-tenant Hardening',      'Per-tenant RLS audit, quota, isolation tests, tenant admin surface. (Phase 10 reserved for OKR-driven slot.)', 10, 'planned'),
  ('phase-11', 'Public API & SDK',            'Stable contract surface, versioning, generated SDK, docs site.', 11, 'planned')
ON CONFLICT (key) DO NOTHING;

-- One placeholder sprint per new phase
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT p.id, v.skey, v.stitle, v.sgoal, 1, 'planned'
FROM public.roadmap_phases p
JOIN (VALUES
  ('phase-5',  's5.1',  'Entity model + alias resolver',  'Schema + resolve_entity() SDF, no UI yet.'),
  ('phase-6',  's6.1',  'Canonical ingest spine',         'Source adapter contract, conflict table, supersede rules.'),
  ('phase-6b', 's6b.1', 'Conflict review surface',        'Operator UI for unresolved conflicts + replay.'),
  ('phase-7',  's7.1',  'Connector manifest v1',          'Manifest schema, validator, install dry-run.'),
  ('phase-9',  's9.1',  'Tenant isolation audit',         'RLS sweep + per-tenant fuzz tests.'),
  ('phase-11', 's11.1', 'Contract freeze v1',             'Pin awip-api surface, version header, deprecation policy.')
) AS v(pkey, skey, stitle, sgoal) ON v.pkey = p.key
WHERE NOT EXISTS (SELECT 1 FROM public.roadmap_sprints WHERE key = v.skey);

-- Sentinel "Open questions" task per new sprint
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, status, "order")
SELECT s.id, 'open-questions', 'Open questions',
       'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.',
       'todo', 0
FROM public.roadmap_sprints s
WHERE s.key IN ('s5.1','s6.1','s6b.1','s7.1','s9.1','s11.1')
  AND NOT EXISTS (
    SELECT 1 FROM public.roadmap_tasks t WHERE t.sprint_id = s.id AND t.key = 'open-questions'
  );
