# AGENTS.md

Operating instructions for AI agents (Lovable, Claude Code, Cursor, Codex) working in AWIP Core.

## Read first

1. [`CONTEXT.md`](./CONTEXT.md) — the five non-negotiable rules. Read every session.
2. [`README.md`](./README.md) — what this project is and how it's structured.
3. [`docs/architecture.md`](./docs/architecture.md) — data model and event streams.
4. [`.lovable/plan.md`](./.lovable/plan.md) — current v1 plan and status.

## Working agreements

- Database changes go through migrations only — never edit `src/integrations/supabase/types.ts`.
- Edge functions auto-deploy on save; do not tell the user to deploy.
- Wrap every new edge function with `withLogger` from `supabase/functions/_shared/logger.ts`.
- Roles live in `public.user_roles`, gated by `has_role()`. Never trust client storage for authz.
- Idempotency-Key is mandatory on `/okr/ingest` and `/events/ingest`. Same key + different body → `409`.
- Speak about the backend as "Lovable Cloud", not Supabase, when addressing the user.
- Before adding a new autonomous surface (cron, edge function, LLM loop), declare a typed input contract in `supabase/functions/_shared/contracts/<name>.ts` — see [`docs/agents/contract-checklist.md`](./docs/agents/contract-checklist.md) and the `night-agent.ts` reference.

## Agent skills

This project uses [Matt Pocock's skills framework](https://github.com/mattpocock/skills). Skills are short, composable instruction packs that AI agents can opt into for specific tasks.

Install once at the repo root:

```bash
npx skills add https://github.com/mattpocock/skills
```

### Engineering skills (from mattpocock/skills)

| Skill | Use when |
|---|---|
| `grill-me` | You want the agent to challenge your assumptions before writing code |
| `grill-with-docs` | Same, grounded in linked documentation |
| `tdd` | New behaviour — write the failing test first |
| `diagnose` | A specific bug or failing CI run; produce a hypothesis tree before patching |
| `triage` | Inbox of issues / sentinel findings — sort by severity and blast radius |
| `to-issues` | Convert a discussion or plan into discrete, well-scoped issues |
| `to-prd` | Promote a rough idea to a product requirements doc |
| `request-refactor-plan` | Before any refactor touching > 1 file, get a plan first |

Invoke a skill by referencing it in your prompt: `Use the tdd skill to add the worker reclaim test`.

### AWIP-specific skills

Live in [`docs/agents/`](./docs/agents/). Reference them by path or filename.

| Skill | Purpose |
|---|---|
| [`awip-core-rules`](./docs/agents/awip-core-rules.md) | Recap the five non-negotiable Core rules before any API or schema change |
| [`awip-module-register`](./docs/agents/awip-module-register.md) | Correct flow for registering a new module/capability with Core |

When a task touches the contract API, the database schema, or module registration, load the relevant AWIP skill before planning.

## Definition of done

- All migrations applied; `bun run rls:verify` passes.
- New edge functions wrapped with `withLogger` (or exempted with a reason comment).
- Tests added for new behaviour; existing suites still green.
- Docs updated: `README.md`, `CHANGELOG.md`, and the relevant `docs/*.md`.
- Memory updated (`mem://...`) when a durable rule or constraint is established.
