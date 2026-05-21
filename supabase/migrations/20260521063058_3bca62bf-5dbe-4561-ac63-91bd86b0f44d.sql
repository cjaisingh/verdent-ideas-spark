-- 1. Operator signoff for the four overnight phases (idempotent: skip if any exists)
INSERT INTO public.roadmap_phase_signoffs
  (phase_id, phase_key, approver, decided_at, gate_snapshot, notes, override_rationale)
SELECT
  p.id,
  p.key,
  'operator:cjaisingh',
  now(),
  jsonb_build_object(
    'signoff_kind', 'overnight_strategy_only',
    'tables_present', false,
    'guarded_by', 'phase-contract-map.ts envelope + auto_blocked terminal'
  ),
  'Unblock overnight strategy passes for Phase 5/6/6b/7. Tables (tenant_nodes, canonical_facts, fact_conflicts) not yet built — runs produce strategy + recommendations only against retrieval contracts. Re-sign with real gate_snapshot once s5.1 migration lands.',
  'no formal gate yet; operator-approved interim to unblock contract-envelope dry runs'
FROM public.roadmap_phases p
WHERE p.key IN ('phase-5','phase-6','phase-6b','phase-7')
  AND NOT EXISTS (
    SELECT 1 FROM public.roadmap_phase_signoffs s WHERE s.phase_id = p.id
  );

-- 2. Reset today's auto_blocked runs so the runner retries them on the next tick
UPDATE public.roadmap_phase_overnight_runs
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    heartbeat_at = NULL
WHERE scheduled_for = current_date
  AND status = 'auto_blocked'
  AND phase_key IN ('phase-5','phase-6','phase-6b','phase-7');