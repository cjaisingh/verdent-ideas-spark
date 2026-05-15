# Agent contract checklist

When you add a new autonomous surface (a cron job, an edge function that loops
over rows, an LLM-driven loop), define its **contract** before writing the
handler. A contract is a typed declaration of the input packet the agent is
guaranteed to receive and the output shape it must return. It lives in
`supabase/functions/_shared/contracts/<name>.ts`.

This is the "pick the contract first" principle (see
`mem/preferences/contract-first.md`). It exists to prevent the failure mode
where each handler invents its own ad-hoc retrieval, burning context and
duplicating SELECTs that nobody can audit.

## The seven fields

Every contract file must declare these, even if some are empty in v0:

| Field | What goes here |
|---|---|
| **Canonical question** | One sentence. The single decision the agent answers per iteration. |
| **Mandatory evidence** | Object classes the handler MUST receive. Typed, not optional. |
| **Optional evidence** | Helpful but non-blocking context. Typed as `?`. |
| **Output shape** | Discriminated union of valid verdicts. No free-form strings. |
| **Escalation rule** | The exact condition that sends the case to operator review. |
| **Truth profile** | Which `decision_authorities` entity the agent's outputs claim against. |
| **Audit hook** | Which `*_events` table records the run. Append-only by definition. |

## File layout

```ts
// supabase/functions/_shared/contracts/<name>.ts

export type <Name>Input = { /* mandatory + optional fields */ };
export type <Name>Output = /* discriminated union */;

export const <NAME>_CONTRACT = {
  canonicalQuestion: "...",
  mandatoryEvidence: [...] as const,
  optionalEvidence: [...] as const,
  escalationRule: "...",
  auditTable: "...",
  truthEntity: "...",
} as const;

export function build<Name>Input(...): <Name>Input { /* pure */ }
```

The builder must be a pure function — no DB I/O — so call sites can construct
the packet from data they already have in scope. Hydration of optional fields
(extra reads) goes in a separate helper that takes an `SbClient`.

## Reference implementation

`supabase/functions/_shared/contracts/night-agent.ts` is the worked example.
Mirror its shape unless you have a reason not to.

## What the checklist is **not**

- It is not a runtime framework. There is no "contract registry" service. The
  contract is a TypeScript file; the type checker is the enforcement.
- It is not a YAML schema. Keep contracts in code so they typecheck against
  the database types in `src/integrations/supabase/types.ts`.
- It is not a replacement for `decision_authorities` or `*_events`. Those
  remain the source of truth for who-can-decide-what and what-actually-happened.
  The contract just makes the agent's *input* explicit.
