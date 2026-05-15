---
name: Contract-first for new agent surfaces
description: Before adding any autonomous loop (cron, edge fn, agent), declare a typed input contract in supabase/functions/_shared/contracts/ — never let handlers invent their own retrieval
type: preference
---

Before adding a new autonomous surface (cron, edge function, LLM loop), define its **contract** first: canonical question, mandatory evidence, output shape, escalation rule, truth entity, audit table. Code the input packet as a typed object in `supabase/functions/_shared/contracts/<name>.ts`, not as ad-hoc SELECTs scattered across the handler.

**Why:** prevents the "agent improvises retrieval" failure mode (re-asks what the system already knows, burns context window, makes audit lineage impossible). Makes the agent's input explicit and typechecked against `src/integrations/supabase/types.ts`.

**How to apply:** see `docs/agents/contract-checklist.md` for the seven required fields and `supabase/functions/_shared/contracts/night-agent.ts` for the worked example. Builder function is pure (no DB I/O); a separate hydration helper takes an `SbClient` if optional fields need extra reads.

**Not:** a YAML registry, a runtime framework, or a replacement for `decision_authorities` / `*_events`. Just a typed declaration of what the agent receives.
