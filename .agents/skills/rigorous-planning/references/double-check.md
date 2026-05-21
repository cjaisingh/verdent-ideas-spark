# Persona double-check map

Map the plan's blast radius to the personas in `docs/agents/team/`. Load each triggered persona and write one bullet per persona under "Persona sign-off" capturing their likely objection and the plan's answer.

## Trigger → persona

| If the plan touches… | Load these personas |
| --- | --- |
| OKR tree, `okr_nodes`, `okr_node_events` | `okr-strategist`, `event-engineer` |
| `capabilities`, `capability_events`, module registration | `capability-architect`, `event-engineer` |
| RLS, `user_roles`, multi-tenant data, `tenant_nodes` | `tenant-manager`, `compliance-auditor` |
| New cron, edge function, agent loop | `sentinel`, `event-engineer` + contract-first preference |
| Phase gates, sign-off, security gating | `compliance-auditor` |
| Routing or "who acts when" logic | `control-plane-operator` (and reconsider — Core doesn't route) |
| `CONTEXT.md`, ADR, `docs/why-awip.md`, README, AGENTS.md | `product-historian` |
| Demand board, dead-weight features | `demand-analyst` |
| Any mutation to a public table | `event-engineer` (event row?) + `tenant-manager` (RLS?) |

## Default trio

Even if no specific trigger fires, sanity-check against:
1. **event-engineer** — does every mutation emit an event row?
2. **tenant-manager** — can cross-tenant reads/writes leak?
3. **product-historian** — does CHANGELOG + doc + mem update land in the same plan?

## Output format

```
- okr-strategist: would reject X because Y → plan answers by Z.
- event-engineer: requires `<table>_events` row on UPDATE/DELETE → handled by trigger `<name>` in step <n>.
- tenant-manager: cross-tenant alias collision → plan enforces tenant_id scoping in resolver (step <n>).
```

One sentence per persona. If the answer is "no objection", say so and move on.
