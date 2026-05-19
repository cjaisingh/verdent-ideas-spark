# System Prompts & Models of AI Tools — Reference

**Repo:** https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools
**Stars:** ~137k

A leaked / reverse-engineered collection of full system prompts and internal tool definitions for major AI coding tools: Cursor, Windsurf, Lovable, Replit, Claude Code, v0, Devin, Manus, Perplexity, Kiro, Warp, Xcode, Augment Code, and others.

## Why it matters to AWIP

- **Competitive intelligence** — compare how top tools instruct their agents against AWIP's [`AGENTS.md`](../../AGENTS.md) and the agent team personas in [`docs/agents/team/`](../agents/team/).
- **Prompt patterns** — constraints, tone, guardrails, refusal patterns used by best-in-class tools. Reference material for Capica routing logic and AWIP skill files in [`docs/agents/`](../agents/).
- **Persona quality benchmark** — measuring stick for the nine personas in [`docs/agents/team/`](../agents/team/); cross-check scope, voice, and challenge mechanics against Cursor and Claude Code.

## Priority reads

1. **Cursor** — closest analogue to the multi-agent + tool-routing model AWIP is building toward.
2. **Claude Code** — most relevant to AWIP's agent team structure and skill-based composition.

Lower priority but useful: Windsurf (planning loops), Devin (autonomy/escalation), v0 (UI-generation guardrails).

## Usage notes

- Treat as third-party / unofficial; verify any pattern against the vendor's current public docs before adopting.
- Do not copy prompts verbatim into AWIP — extract patterns, then write to AWIP's voice and rules.
- Re-pull periodically; the repo is updated as new versions leak.
