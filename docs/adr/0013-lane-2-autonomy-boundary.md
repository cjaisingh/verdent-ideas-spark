# ADR-0013: Lane 2 autonomy boundary

- **Status:** proposed
- **Date:** 2026-07-17
- **Deciders:** (operator sign-off required before acceptance — see Rollout)
- **Tracks:** issue #35

## Context

AWIP today runs **Lane 1 only**: it observes and proposes, it does not act. The
`night-agent` pulls eligible jobs, runs its QA gates, and **queues proposals**
with an audit summary; force-open is operator-JWT-gated and cron never
self-bypasses. Every scheduled function writes audit tables (`automation_runs`,
`night_observations`, `night_task_audit`, sentinel findings) — none execute a
change on their own. The human-approval surface (`approvals` table,
`ApprovalDetail`/`ApprovalPack`/`ApprovalsBody`, `PendingApprovalsIndicator`)
already exists and is the natural trust boundary for anything that acts.

The open question — the biggest architectural decision left in the programme —
is **"Lane 2": what, if anything, may AWIP execute without a human in the
loop?** The forces:

- **Toil reduction.** Operators re-run failed crons, refresh stale caches, and
  chase stuck internal jobs by hand. Safe, reversible, internal actions are
  pure toil that autonomy could remove.
- **Consequence.** AWIP operates in facilities management for real client
  estates. A wrong action can be client-visible, safety-relevant, cost-bearing,
  or cross a tenant boundary. "Team loses belief" is one of the four failure
  modes AWIP exists to prevent — one bad autonomous action erodes trust
  disproportionately.
- **Governance.** The W10 programme adds a DPA, retention, and legal-hold
  regime. Autonomy must fit inside that governance, not around it.

Absent an explicit boundary, autonomy would either never ship (perpetual toil)
or ship ad hoc (unbounded risk). This ADR sets the boundary.

## Decision

**Adopt a risk-tiered autonomy model gated on reversibility and blast radius.
Only Tier 0 actions — internal, reversible, idempotent, with no external or
client-visible effect and no spend — may execute autonomously; every Tier 1+
action routes through the existing approval workflow. No action acts
autonomously until (a) this ADR is accepted, (b) a global kill-switch is
enabled, and (c) that specific action is individually registered with its tier,
its reversal/compensation, and a rate limit.** Autonomy is an allowlist, not a
default: an action is gated unless it has been explicitly registered as Tier 0.

### Risk tiers

| Tier | Definition | Path | Examples |
|------|------------|------|----------|
| **0 — Autonomous-eligible** | Internal to AWIP, reversible, idempotent, rate-limited; no external call, no client-visible change, no spend, no mutation of tenant canonical data | Executes automatically; emits an `autonomy_action` event | Re-run a failed *internal* cron; refresh a materialised cache / rollup; retry a stuck internal job within a bounded attempt count; regenerate a derived view; raise an *operator-facing* alert |
| **1 — Operator-gated** | Any client-visible change, capability status change, OKR mutation, write to a tenant's canonical data, or new schedule affecting an external system | Creates an approval row (operator mode); does **not** execute until decided | Change a capability to `deprecated`; supersede a canonical fact; enqueue a client notification |
| **2 — Elevated / four-eyes** | Spend above threshold, deletion/tombstone of client data, credential or secret changes, anything crossing a tenant/trust boundary, legal-hold changes | Approval in `four_eyes` mode where >1 operator exists; otherwise blocked and queued | Retention tombstone; rotate a module token; cross-tenant operation |
| **3 — Never autonomous** | Irreversible + high-consequence, data exfiltration risk, mass/multi-tenant operations | Prohibited from the autonomy path entirely; human-initiated only | Bulk delete; export across engagements |

### Enforcement mechanism

- **Single gate, reusing approvals.** Every candidate action declares its tier
  via an autonomy registry (`autonomy_actions` — action key → tier, reversal
  descriptor, rate limit, enabled flag). A shared `autonomyGate(action_key,
  payload)` resolves the tier: **Tier 0** executes and emits an
  `autonomy_action` event; **Tier 1/2** create an `approvals` row (reusing the
  W10 lifecycle/approval machinery) and return without executing; **Tier 3**
  raises. No bespoke second gate is built.
- **Global kill-switch.** `app_secrets.AUTONOMY_ENABLED` (default `false`). While
  false, Tier 0 logs "would have executed" instead of acting (shadow mode).
- **Reversibility is mandatory for Tier 0.** Each registered Tier-0 action ships
  a documented reversal or compensating action and a rate limit; a
  `autonomy_action_burst` sentinel pages on anomaly.
- **Everything is evented.** Autonomous executions and gate decisions are
  auditable (`autonomy_action` events), consistent with AWIP's "events on every
  mutation" rule.

### Options considered

1. **Status quo — no autonomy.** Safest; keeps all toil. This is the default
   *until* this ADR lands, but is rejected as the long-term answer.
2. **Blanket autonomy with post-hoc audit.** Maximal toil reduction, but
   unacceptable blast radius in a regulated FM context. Rejected.
3. **Risk-tiered allowlist gate (chosen).** Bounds autonomy to reversible
   internal actions, reuses the approval workflow for everything else, and grows
   action-by-action under review.

## Consequences

**Easier.** Operators stop hand-running safe internal recovery actions. The
boundary is explicit and auditable, so "why did AWIP do that?" always has an
answer (tier + event + reversal). No new approval surface is built — Tier 1/2
reuse what W10 already ships.

**Harder.** Every new autonomous action carries upfront cost: a tier
declaration, a reversal/compensation design, a rate limit, and a registry entry
with review. Tier 0 is deliberately narrow, so some "obviously safe-looking"
actions still route to approval until they earn a Tier-0 registration.

**Explicitly accepted.** Slower autonomy rollout in exchange for trust and
safety. In v1 there is **no** autonomous client-facing action, **no** autonomous
spend, and **no** autonomous cross-tenant operation. `four_eyes` ships dormant
until a second operator exists.

**Not doing.** We are not building a general autonomous agent, not granting the
night-agent execution rights, and not bypassing the approval workflow for any
Tier 1+ action.

## Rollout (gates before acceptance)

1. Accept this ADR with **operator sign-off** (per the W10 S2 readiness gate,
   Lane-2 acting also requires the human-gate posture to be signed off).
2. Land the `autonomy_actions` registry + `autonomyGate` + `autonomy_action`
   event kind + `autonomy_action_burst` sentinel, all behind
   `AUTONOMY_ENABLED=false`.
3. **Two-week shadow period:** Tier 0 logs "would have executed"; review the log
   before flipping the switch.
4. Enable Tier 0 behind the kill-switch. Expand the Tier-0 allowlist one action
   at a time, each with its own registration + review; never widen a tier by
   default.
