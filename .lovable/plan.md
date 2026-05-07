# Copilot Agents — multi-persona with scoped access

Today there's one Copilot per user (`copilot_settings`). We'll turn that into a **shared catalog of named agents** (Dev, Admin, etc.), each with its own scope — tools, table reads, voice, and approval risk — and let each operator override voice/greeting/audio for themselves. Agents are picked by **wake-word** during a session.

## Data model

Two new tables, plus a slim change to `copilot_settings`.

**`copilot_agents`** (shared catalog, operator-only RLS, admin-write)
- `id uuid pk`, `slug text unique` (e.g. `dev`, `admin`)
- `name text` (e.g. "Rex"), `wake_word text unique` (e.g. "rex")
- `description text`, `system_prompt text`
- `tts_voice text`, `language text`, `default_greeting text`
- `allowed_capability_ids text[]` — keys from `public.capabilities`
- `allowed_tables text[]` — table names the agent may read/summarize
- `max_risk text check in ('low','medium','high')` — anything above goes to `approval_queue`
- `enabled bool`, `order int`, `created_at`, `updated_at`

**`copilot_agent_overrides`** (per-user tweaks)
- `user_id uuid`, `agent_id uuid` → unique together
- `tts_voice text?`, `greeting text?`, `mic_gain numeric?`, `out_volume numeric?`, `noise_gate numeric?`, `enabled bool default true`
- RLS: user can read/write their own rows.

**`copilot_settings`** — add `active_agent_id uuid null` (the agent currently selected for that operator's session). Existing audio fields stay as the global fallback.

Seed two agents:
- **Rex (dev)** — wake "rex", capabilities scoped to roadmap/code-review/test-runs, tables `roadmap_*`, `test_runs`, `automation_runs`, max_risk `medium`.
- **Ada (admin)** — wake "ada", capabilities for user/role mgmt + retention + alerts, tables `user_roles`, `role_change_audit`, `alert_*`, `retention_*`, max_risk `high`.

## /copilot UI changes

```text
┌─ Copilot ──────────────────────────────────────────────┐
│ Active: ● Rex (dev)   [switch] ◇ Ada  ◇ Rex            │
│ "Say 'Hey Ada' or 'Hey Rex' to switch."                │
├──────────────── Agent card ────────────────────────────┤
│ Rex — developer copilot                                │
│ Tools: code-review, deploy-status, test-runs (+2)      │
│ Tables: roadmap_tasks, test_runs, automation_runs      │
│ Max risk: medium  •  Voice: aura-2-orion-en            │
│ [Override voice / greeting / gain for me]              │
└────────────────────────────────────────────────────────┘
```

- New `AgentSelector` component above the existing audio card; chips for each enabled agent, the active one highlighted.
- New `AgentScopeCard` showing the active agent's tools, tables, max_risk, and a collapsible "My overrides" form.
- Existing audio controls (mic gain, output volume, noise gate, presets) remain — they apply to the active agent and persist into `copilot_agent_overrides` instead of `copilot_settings` when an agent is active.
- Transcript header shows the active agent's name + wake-word badge.

## Wake-word switching

In the Deepgram transcript handler in `Copilot.tsx`:
- Maintain `agentsByWake: Record<string, Agent>` loaded once.
- On every final transcript, lowercase + strip punctuation, look for `hey <wake>` or bare `<wake>` at the start.
- On match: setActiveAgent, persist `active_agent_id`, swap TTS voice ref, append a system line to the transcript ("→ switched to Ada"), and play the new agent's greeting.
- No match → route the utterance to the currently active agent.

## Scope enforcement (where it actually bites)

The agent record is just metadata until something reads it. We enforce in two spots:

1. **Client (UX guardrail)** — when Copilot offers a suggested action, we filter the action list by `allowed_capability_ids` so disabled tools never appear for that agent.
2. **`awip-api` edge function (authoritative)** — add a small middleware: if the caller passes `x-copilot-agent: <slug>`, the function loads that agent and rejects the call when:
   - the requested `capability_id` is not in `allowed_capability_ids`, **or**
   - the requested table (for db-read endpoints) is not in `allowed_tables`, **or**
   - the action's risk exceeds `max_risk` → enqueue into `approval_queue` instead of executing.

   Rejections are logged to `db_explorer_audit` / `api_call_logs` with `rejection_reason = 'agent_scope'`.

## Admin: manage the catalog

A new `/copilot/agents` admin route (admin-role only) with a table of agents and a drawer to edit name, wake-word, prompt, voice, allowed capabilities (multi-select from `capabilities`), allowed tables (multi-select from `db_list_tables`), and max_risk. Changes write a row to `memory_audit_log` so the catalog has a history.

## Migration / seeding plan

1. SQL migration: create `copilot_agents`, `copilot_agent_overrides`, add `active_agent_id` to `copilot_settings`, RLS policies, realtime publication, seed Rex + Ada with sensible scopes.
2. Update `src/pages/Copilot.tsx` to load agents, render selector + scope card, handle wake-word switching, persist overrides.
3. Add `src/pages/CopilotAgents.tsx` (admin) and route entry.
4. Update `awip-api` edge function: agent scope middleware + audit reason.
5. Update CHANGELOG and the Copilot section of README.

## Out of scope (call out)

- Generating per-agent system prompts dynamically — admins write them by hand for now.
- Sharing transcripts between agents — each switch starts a fresh logical thread in the existing transcript view.
- Voice biometrics — wake-word match is text-only from Deepgram.
