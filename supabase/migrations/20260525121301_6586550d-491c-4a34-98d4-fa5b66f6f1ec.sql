
-- Phase 5/6 lane: capability registration + observability watcher + 10 more retrieval declarations.

-- 1. Register the deterministic resolver as a capability (idempotent).
INSERT INTO public.capability_events (capability_id, event_type, actor, payload)
SELECT 'entity_resolution.deterministic_v1', 'registered', 'system',
       jsonb_build_object(
         'rpc', 'public.resolve_entity',
         'edge_fn', 'entity-resolve',
         'bands', jsonb_build_object('auto_bind', 0.85, 'conflict', 0.55, 'no_match', 0.0),
         'cross_tenant', false,
         'declared_in', 's5.2/t3'
       )
WHERE NOT EXISTS (
  SELECT 1 FROM public.capability_events
  WHERE capability_id = 'entity_resolution.deterministic_v1'
    AND event_type = 'registered'
);

-- 2. Observability watcher for resolver_no_match_burst (1h window, p95 no-match > 20% → medium).
INSERT INTO public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
VALUES
  ('agent', 'resolver_no_match_burst', 15,
   ARRAY['resolver_no_match_burst'],
   'tenant-manager',
   'Fires medium when >20% of resolve_entity calls in last 1h return no_match (signals corpus drift or normaliser regression).',
   's5.2/t3')
ON CONFLICT (surface_kind, surface_id) DO UPDATE
  SET watcher_kinds = EXCLUDED.watcher_kinds,
      notes = EXCLUDED.notes,
      declared_in = EXCLUDED.declared_in,
      updated_at = now();

-- 3. Declare 10 more retrieval contracts (s6.1/t0 sweep, batch 2).
INSERT INTO public.retrieval_contracts
  (consumer, consumer_kind, shape, store, primary_key, token_budget, freshness_window, fallback, declared_by, status, notes)
VALUES
  ('overnight-phase-runner', 'agent_loop', 'tabular',
   'postgres:public.roadmap_phase_overnight_runs',
   '(phase_key, run_id)', 4000, '15m',
   'Skip phase + emit contract_envelope_rejected alert; no retry.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   'Reads pending phases + binds to phase-contract-map; consumes RETRIEVAL_* contracts inside the run.'),

  ('lessons-loop', 'cron', 'prose',
   'postgres:public.lessons + public.discussion_actions',
   '(id)', 6000, '7d',
   'Skip week if AI synthesis fails; next run picks up the gap.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   'Weekly AI synthesis over completed actions + postmortems → public.lessons.'),

  ('deep-audit', 'cron', 'tabular',
   'postgres:public.audit_runs + 5 module views',
   '(audit_run_id, module)', 8000, '7d/30d',
   'Module skipped if its source view is empty; aggregate still emits.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   'Weekly + monthly 5-module platform audit; high/critical → auto-promote to lessons.'),

  ('app-walkthrough', 'cron', 'tabular',
   'postgres:public.walkthrough_runs',
   '(run_id, route)', 2000, '24h',
   'Failure → sentinel finding; route marked degraded for next run to retry.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   'Nightly 02:15 UTC route + capability self-test sweep.'),

  ('operator-inbox-ingest', 'edge_fn', 'relational',
   'postgres:public.inbox_items + public.discussion_actions',
   '(source, source_ref)', 3000, 'realtime',
   'Unclassified → manual queue (kind=unknown); inbox_kind_classify_failures sentinel fires.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   'Telegram + manual-paste inbox; prefix→LLM→manual classifier; auto-promotes idea/research/suggestion.'),

  ('quarterly-review-open', 'cron', 'prose',
   'postgres:public.discussion_actions',
   '(idempotency_key)', 1000, '90d',
   'Idempotent on (year, quarter); replay safe.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   'Q1/Q2/Q3/Q4 09:00 UTC; opens idempotent discussion_action linking to docs/quarterly-review.md.'),

  ('tomorrow-plan-refresh', 'cron', 'tabular',
   'postgres:public.tomorrow_plans + public.tomorrow_plan_items',
   '(plan_date, item_id)', 4000, '15m',
   'Stale plan kept; banner on /morning-review Tomorrow tab signals freshness gap.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   '15-min auto-refresh of operator daily plan dashboard.'),

  ('governance-ui', 'ui_route', 'graph',
   'postgres:public.governance_links + governance_chain()',
   '(entity_kind, entity_id)', 2000, 'realtime',
   'Empty chain rendered as "no coverage" banner; never blocks the route.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   '/governance page traversal: task↔notebook↔entity↔authority_rule.'),

  ('ontology-ui', 'ui_route', 'hierarchical-doc',
   'fs:docs/ontology.md',
   '(entity)', 1500, 'on-deploy',
   'Markdown parse failure → render last successful version; sentinel logs.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   '/ontology page; markdown is source of truth, surfaced read-only.'),

  ('master-plan-ui', 'ui_route', 'tabular',
   'postgres:public.roadmap_phases + public.roadmap_tasks',
   '(phase_key, task_key)', 4000, 'realtime',
   'Realtime channel reconnect on disconnect; stale data acceptable up to 60s.',
   's6.1/t0 sweep 2026-05-25', 'declared',
   '/master-plan page; phase/task table with overnight queue card.')
ON CONFLICT (consumer) DO UPDATE
  SET shape = EXCLUDED.shape,
      store = EXCLUDED.store,
      primary_key = EXCLUDED.primary_key,
      token_budget = EXCLUDED.token_budget,
      freshness_window = EXCLUDED.freshness_window,
      fallback = EXCLUDED.fallback,
      declared_by = EXCLUDED.declared_by,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      updated_at = now();
