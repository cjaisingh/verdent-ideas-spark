## Goal

Adopt the parts of the external AWIP setup pack that genuinely add to AWIP Core, without re-platforming what we already have. Three small, additive artefacts. No DB changes, no runtime behaviour change, no overlay/bundle framework — just naming + one typed contract on the highest-stakes agent surface (Night Agent) to prove the pattern.

## Why these three (and not the rest)

The pack's ontology, truth-policy, run-memory, governance, and source-mapping ideas are already implemented under different names (`docs/ontology.md`, `decision_authorities`, `*_events`, `governance_links`, `capability_manifest`). Re-importing them would be churn.

The genuinely missing concept is **"the agent's input packet is implicit today — nobody can point to a typed definition of what the Night Agent is guaranteed to receive."** Fixing that for one agent is cheap and proves whether the pattern is worth generalising.

## Changes

### 1. Memory: contract-first principle

New file `mem/preferences/contract-first.md`:

> Before adding a new agent surface (cron, edge fn, autonomous loop), define its **contract**: canonical question, mandatory evidence, output shape, escalation rule. Code the input packet as a typed object in `supabase/functions/_shared/contracts/`, not as ad-hoc SELECTs in the handler. Rationale: prevents "agent improvises retrieval" failure mode; makes audit lineage trivial.

Add one-liner to `mem://index.md` under `## Memories`.

### 2. Docs: agent contract checklist

New file `docs/agents/contract-checklist.md` — short markdown, ~40 lines:

- Canonical question (one sentence)
- Mandatory evidence (object classes the handler MUST receive)
- Optional evidence
- Output shape (typed return)
- Escalation rule (when to bail to operator)
- Truth profile (which `decision_authorities` rules apply)
- Audit hook (which `*_events` table records the run)

Reference from `AGENTS.md` under "Working agreements".

### 3. Code: Night-Agent input contract (typed, no behaviour change)

New file `supabase/functions/_shared/contracts/night-agent.ts`:

```ts
// Typed contract for the Night Agent's per-action input packet.
// Source of truth for what the agent is guaranteed to receive.
// See docs/agents/contract-checklist.md.

export type NightAgentInput = {
  action: DiscussionAction;          // the row being audited
  risk: 'low' | 'medium' | 'high';   // critical never reaches here
  nightOverrideReason: string | null; // required if risk=high
  recentEvents: DiscussionActionEvent[]; // last 20, for context
  linkedFindings: SentinelFinding[];     // via discussion_action_findings
  truthProfile: {
    entity: 'Action';
    authorities: DecisionAuthority[];    // from resolve_truth
  };
};

export type NightAgentOutput =
  | { verdict: 'advance'; toStatus: string; rationale: string }
  | { verdict: 'hold'; reason: string }
  | { verdict: 'escalate'; reason: string; suggestedOwner?: string };

export const NIGHT_AGENT_CONTRACT = {
  canonicalQuestion:
    "Should this night-eligible discussion_action advance, hold, or escalate?",
  escalationRule:
    "Escalate if risk=high AND no nightOverrideReason, OR if linkedFindings contains any severity>=high open finding.",
  auditTable: "discussion_action_events",
} as const;
```

Then **refactor `night-agent-open` and `night-agent-close` to build a `NightAgentInput` once** at the top of each iteration and pass it to the existing logic. No semantic change — just makes the implicit packet explicit and typed. Existing tests stay green.

## Out of scope

- No bundle library, overlay library, runtime packet assembler, contract catalog, or YAML specs.
- No changes to Sentinel, Morning Review, Lessons synthesiser (we'll generalise only if the Night Agent contract proves useful).
- No DB schema changes.
- No new pages or UI.
- No changes to truth-policy, ontology, or governance models — they already cover what the pack calls "truth-policy registry" and "run-memory ledger".

## Verification

- `bun run typecheck` passes — `NightAgentInput` types resolve against existing `DiscussionAction` / `SentinelFinding` types.
- Night Agent existing behaviour unchanged: pick a `night_eligible=true` action in `/jobs`, confirm it still flows through `night-agent-open`/`close` cron at the same cadence with the same outputs in `discussion_action_events`.
- `docs/agents/contract-checklist.md` rendered fine on GitHub.
- New memory entry visible in `mem://index.md`.

## What this unlocks (if we like it)

If after a week the Night-Agent contract feels useful, the same pattern extends naturally to: Sentinel tick input, Morning Review writer input, Lessons synthesiser input, Overnight Recommender input. Each becomes one typed file in `_shared/contracts/`. That's the "bundle library" idea — but earned, not imported.
