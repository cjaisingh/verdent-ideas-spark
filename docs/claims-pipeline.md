# W7.2 — Claims pipeline

The claims pipeline turns `resolve_truth(entity, entity_id, field)` from a
"no-claims-yet" stub into a function that picks an actual winner from
competing assertions. It closes the loop on the truth arbitration stack
landed in W7.1 / W7.1.5.

## Tables

### `public.claims`
One row per assertion about an entity field. Append-only in spirit — claims
are never updated except to set `voided_at`. Replacing a claim is done by
inserting a new claim with `supersedes_id = <previous>`; the trigger voids
the predecessor.

| column              | purpose                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| entity, entity_id, field | what the claim is about                                              |
| source              | one of the sources defined in `decision_authorities` (operator/ai/ci/system) |
| value               | jsonb — opaque to the resolver                                           |
| confidence          | 0–1 multiplier applied to the source weight                              |
| evidence_ref        | jsonb pointer to the proof (notebook_id, run_id, sha, url, …)            |
| supersedes_id       | self-fk; trigger voids the predecessor                                   |
| valid_from, valid_to | claim is "active" when now is inside this window                        |
| voided_at, voided_reason | set when superseded or manually voided                              |
| claimed_by, claimed_by_label | actor                                                            |

### `public.claim_events`
Append-only audit log of `created` / `superseded` / `voided` / `expired`
events. Written by the `log_claim_event` trigger.

### `public.truth_conflicts` (view, security_invoker)
Active claims grouped by entity/field where the top two competing sources
share precedence and the score gap is < 10%. Drives the
`truth_conflicts_unresolved` sentinel finding.

## Resolution

`resolve_truth(_entity, _entity_id, _field)` returns:

```jsonc
{
  "entity": "...",
  "entity_id": "...",
  "field": "*",
  "status": "resolved" | "conflict" | "no-claims",
  "winner": { "source": "operator", "value": ..., "score": 0.9, "precedence": 1 },
  "rules": [ /* applicable decision_authorities */ ],
  "claims": [ /* active claims, sorted */ ]
}
```

Selection rule (matches the W7.2 design choice):

1. **Source precedence is hard ordering.** Lowest `precedence` from
   `decision_authorities` wins.
2. **Within the same precedence**, `weight × confidence` wins.
3. **Tie-breaker** is `created_at DESC` (most recent wins).
4. If the runner-up shares the winner's precedence and is from a different
   source with a score within 10%, status becomes `conflict` (winner is
   still returned but the operator should adjudicate).

`override_policy` on the rule is surfaced in `rules[]` for context but does
not change selection — operator-only / hard policies are enforced upstream
by `decision_authorities` precedence (operator already sits at precedence 1
for every entity, so it dominates by design).

## Write paths

- **Operator UI** at `/governance` → "Claims & truth resolution" panel.
  Direct insert via the supabase client (RLS gated by `has_role`).
- **System / CI** via the `claims-ingest` edge function. Accepts an
  operator JWT or the cross-project `x-awip-service-token`. Validates the
  body with zod; same row goes through the audit trigger.

Idempotency is **not** enforced at the column level yet — same source can
re-file the same claim. Use `supersedes_id` to retract.

## Sentinel

`truth_conflicts_unresolved` rolls into `sentinel_findings` via
`sentinel-tick` (15-min cadence). Severity scales with conflict count
(1 → low, 2–4 → medium, ≥5 → high). It auto-resolves when the operator
files a tie-breaking claim.

## What this unlocks

`/governance` coverage stays at 0% by design until claims start flowing.
With W7.2 in place, future work can:

- Backfill claims from existing system tables (every `roadmap_tasks.status`
  change becomes an operator claim on `RoadmapPhase`).
- Have CI emit claims on `TestRun` after each green build.
- Have AI agents emit low-confidence claims that explicitly defer to
  operator override.
