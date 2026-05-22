# Human Oversight

Where the operator stays in the loop. AWIP Core is a substrate — the operator
remains the decision authority for anything risky, irreversible, or
cross-tenant.

## Surfaces requiring operator approval

| Surface | What triggers it | Approval mechanism |
|---|---|---|
| **Night Agent audits** | `discussion_actions.night_eligible=true` AND `risk in (low,med)` | `risk='critical'` is hard-blocked by `enforce_night_eligibility_by_risk` trigger. `risk='high'` requires `night_override_reason`. |
| **Roadmap phase overnight runs** | `roadmap_phases.run_overnight=true` OR per-run "Run overnight" button | Operator must explicitly opt in per phase. `overnight-prequeue` enqueues at 21:55 UTC; cancel any time before the worker picks it up. |
| **Capability promotion** | `capability_promotion_requests` row | `/capability-promotion` page — operator reviews evidence + clicks Approve/Reject. Decision emits `capability_events`. |
| **Tenant boundary changes** | Any change to `tenant_nodes.ancestry_ids` or RLS scoping | Operator-only RLS on the affected tables; UI confirmations on `/tenants/:id`. |
| **Alias revocation cascades** | `entity-resolve /alias/revoke` with `hardRevoke=true` | Idempotency-Key + reason required. Soft-revoke is reversible; hard-revoke triggers ADR-0004 cascade. |
| **Decision authority rules** | Changes to `decision_authorities` | Git-versioned migrations only — no editing UI. Operator merges the PR. |
| **Truth claim conflicts** | `resolve_truth()` returns `status='conflict'` OR sentinel `truth_conflicts_unresolved` fires | `/governance` ClaimsPanel — operator picks the winning claim or files a counter-claim. |
| **Lessons promotion** | Deep Audit auto-promotes `high`/`critical` lessons | Operator reviews on `/admin/lessons`; can demote or dismiss. |
| **Budget breach** | 100% projected month-end spend | `credit_alerts` row + Telegram + red banner. Operator must acknowledge before night runs resume. |

## Operator-only RLS pattern

Every new table that holds findings, recommendations, or queued work is
RLS-gated to `has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin')`.
Service-role calls bypass RLS but must carry `AWIP_SERVICE_TOKEN`.

```sql
create policy "ops_only_select" on public.<table>
  for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
```

## What is NOT gated

Read-only views the operator already trusts:

- Morning Review aggregations (`/morning-review`)
- Sentinel findings list (`/admin/edge-health`, `/audits`)
- AI usage and credit dashboards (`/admin/ai-usage`)

These render data the operator already owns; gating them would only add
friction without changing risk.

## References

- `mem://features/night-agent` — eligibility rules + 5-step pipeline
- `mem://features/jobs-board-risk` — risk field + override trigger
- `mem://features/claims-pipeline` — truth conflict surfacing
- `docs/decision-authority.md` — arbitration ruleset
- `docs/budget-alerts.md` — spend gating
