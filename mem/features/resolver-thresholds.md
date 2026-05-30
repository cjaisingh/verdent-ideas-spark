---
name: Resolver thresholds (s5.2/t2)
description: Operator-editable band cut-offs for resolve_entity_logged; audit + snapshot on every decision
type: feature
---

## Core

- `public.resolver_thresholds (band, min_score, updated_at, updated_by)` — PK `band`, seeded `auto_bind=0.95`, `conflict=0.60`, `no_match=0.00`. Operator/admin read; writes via service-role through `awip-api`.
- `public.resolver_thresholds_audit` — every change writes `(band, before_score, after_score, actor, actor_label, reason ≥ 8 chars, idempotency_key)`.
- `resolver_decisions` now carries `band_thresholds_snapshot jsonb` + `matched_kinds text[]` so every decision is replayable against the rules in force at decision time.

## API

- `GET  /resolver/thresholds` → `{ thresholds: ResolverThresholdRow[] }` (operator).
- `PUT  /resolver/thresholds` → operator JWT only, `Idempotency-Key` mandatory, body validated by `resolver-thresholds.ts` contract. Non-monotone (`auto_bind > conflict > no_match >= 0`) → 422.
- `GET  /resolver/decisions?limit=50` → recent decision log (operator).

## UI

`/admin/resolver` — three inputs (auto_bind/conflict/no_match) + reason textarea + 50-row recent-decisions table. Realtime on `resolver_thresholds` reloads after any change.

## Scoring contract

`resolve_entity_logged` reads thresholds, snapshots them onto the decision row, then bands via `bandFor()` (mirrored in `src/lib/resolver.ts`). Composite scorer sums matched-descriptor weights per candidate node, caps at 1.0, picks highest scorer.

## Out of scope

- Per-tenant threshold overrides (would extend table with nullable `tenant_id`).
- AI tiebreaker on conflict band — Phase 5 Q5 lock keeps v1 deterministic-only.
