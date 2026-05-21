# AWIP Core

Operator console + contract API for the AWIP constellation. Owns the OKR tree, the capability manifest, and the event streams every other AWIP project subscribes to.

## Why AWIP exists

AWIP exists to prevent the four conditions that kill FM AI projects:

1. **Nobody understands the problem** — the OKR tree and capability manifest make explicit what is being solved, why it matters, and how progress is tracked. No vague pilots.
2. **The conditions have changed** — every OKR mutation is recorded with full event history. Priorities can be superseded without losing the trail. The system always reflects current reality.
3. **The cost outweighs the value** — the demand board surfaces which capabilities are actually used, which KRs drive them, and which are dead weight. Cost/value decisions become data-driven.
4. **The team has lost belief** — AWIP is designed to feel like a smart colleague, not a form to fill in. The assistant layer (Capica) exists specifically to maintain engagement and belief.

Full framing in [`docs/why-awip.md`](docs/why-awip.md) — share this with FM stakeholders and new contributors before the architecture docs.

**Docs**

- [Master plan](docs/master-plan.md) — vision, phases, working agreements (live state at `/roadmap`)
- [Phase overnight guide](docs/phases-overnight-operator-guide.md) — what tonight's Phase 5/6/6b/7 runs will and won't do, with morning checks
- [Phases 5/6/6b research](docs/phases-5-6-6b-research.md) — locked invariants + open questions feeding those phases
- [ADR benchmarks](docs/adr/benchmarks.md) — datasets + metrics + thresholds for closing ADR-0003..0006
- [Architecture overview](docs/architecture.md) — data model, event streams, how consumers read them
- [API reference](docs/api.md) — every `/awip-api` endpoint with examples
- [Local development](docs/development.md) — clone, env vars, migrations, edge functions
- [Modules](docs/modules.md) — placeholder projects in the constellation + scaffold for new ones
- [Security](docs/security.md) — RLS policies, operator roles, service-token validation
- [Data sovereignty](docs/sovereignty.md) — region (`eu-west-1`), sub-processors, egress, tier roadmap
- [Automation](docs/automation.md) — scheduled code review, nightly tests, QA probes, failure alerts
- [CI/CD](docs/ci-cd.md) — GitHub Actions pipelines for quality gates and deploys; includes [Production deploy secrets reference](docs/ci-cd.md#production-deploy-secrets--where-to-find-each-value) (the three Supabase secrets needed to enable Deploy Production)
- [Design system](docs/design-system.md) — page layout, spacing, semantic tints, pane source colours
- [Deepgram voice](docs/deepgram-voice.md) — required key role, token grant flow, mic failure recovery
- [Gemini TTS](docs/gemini-tts.md) — `gemini-tts` edge function, 8 voices, cost, logging
- [`awip-rag` knowledge base](docs/awip-rag.md) — full-text search over repo docs (Companion + Copilot)
- [Edge function audit](docs/edge-function-audit.md) — inventory of all 35 functions and how each is invoked
- [Migrations](docs/migrations.md) — naming convention; full chronological [index](docs/migration-index.md)
- [Rork iPhone companion spec](docs/rork-companion-spec.md) — contract between Core and the separate Expo app
- [Changelog](CHANGELOG.md) — major v1 milestones
- [v1 plan + status](.lovable/plan.md)

## What's in this project

- **Database** (Lovable Cloud / Postgres + RLS)
  - `tenants`, `okr_nodes`, `okr_measurements`, `okr_node_events`
  - `capabilities`, `capability_connectors`, `capability_events`
  - `idempotency_keys`, `api_call_logs`
  - `user_roles` (operator / admin via `has_role()`)
- **Contract API** — single edge function `awip-api` (auth via operator JWT or `x-awip-service-token`)
- **Operator UI** — Tenants, Capabilities, Events, API logs, **Control Plane** (demand board + live feed), Capability detail

## Contract endpoints

All endpoints accept either an operator JWT (`Authorization: Bearer …`) or the cross-project service token (`x-awip-service-token: …`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/capabilities` | Manifest, optional `?status=` filter |
| `POST` | `/capabilities/register` | Module self-registration (upsert + emit `registered`) |
| `POST` | `/okr/ingest` | Ingest a draft OKR tree. Requires `Idempotency-Key` header for safe replay |
| `POST` | `/okr/:id/spawn` | Spawn a sub-OKR with mandatory `spawned_from_reason` |
| `POST` | `/okr/:id/supersede` | Replace a node, preserving history |
| `GET` | `/okr/tree?tenant_id=…` | Full tree (incl. superseded) |
| `GET` | `/events/recent` | Merged OKR + capability event stream. Params: `limit`, `since`, `tenant_id` |
| `GET` | `/capabilities/demand` | Capabilities ranked by `active_kr_count`, then `tenant_count`. Surfaces `unknown` capabilities referenced by KRs but never registered |
| `GET` | `/capabilities/:id/demand-detail` | Capability + driving KRs + tenants |
| `GET` | `/capabilities/promotion-status` | Admin-only. Phase-3 maturity gates per capability. See `docs/capability-promotion.md` |
| `GET` | `/night-agent/promotion-audit?proposal_id=…` | Admin-only. Before/after report (gates, skip reasons, candidates) for an operator-confirmed Night Agent promotion. See `docs/promotion-audit.md` |
| `GET` | `/capabilities/:id/promotion-status` | Admin-only. Single-capability variant |
| `POST` | `/capabilities/:id/promote` | Admin-only. Promote to `available` if no gates fail. Idempotent |
| `POST` | `/capabilities/:id/ack-warnings` | Admin-only. Ack warning-level gates with a rationale |

Every call is logged to `api_call_logs` (route, status, duration, actor, idempotency replay flag).

## Design rules (don't break these)

1. Every OKR mutation emits an `okr_node_events` row.
2. Every manifest change emits a `capability_events` row.
3. All write endpoints are idempotent — same `Idempotency-Key` returns the original response.
4. No "who acts when" logic in Core. Routing belongs in the Control Plane.

## Operator console

`/dashboard` is the per-operator landing page: 1–4 server-persisted tabs, fixed bento templates, and a small widget registry pulling from existing hooks (pending approvals, night observations, open risks, recent capability events). See [docs/operator-dashboard.md](docs/operator-dashboard.md).

Header has a 4-mode pane toggle (left only / dual / centre / bottom): switch with the icon row or `⌘1`–`⌘4`. Right pane streams live Night Agent observations; bottom pane is a live event ticker for OKR / capability / discussion events. Mode is persisted per top-level route in `localStorage`. See [docs/operator-panes.md](docs/operator-panes.md).

The left sidebar has a per-operator **Favorites** section (hover any row → click the star to pin, max 6) and a collapsible **Copilot** subgroup under Operate (Agents / Profile / Lessons / Transcripts). Status dots flag rows with real signal (pending approvals, recent night observations). See [docs/operator-sidebar.md](docs/operator-sidebar.md).

## Development

```bash
bun install
bun run dev
```

Database changes go through migrations only — never edit `src/integrations/supabase/types.ts`. Edge function code lives in `supabase/functions/awip-api/index.ts` and deploys automatically on save.

## Agent Skills

This repo uses [Matt Pocock's skills framework](https://github.com/mattpocock/skills) so AI agents (Lovable, Claude Code, Cursor, Codex) load the right context for the task at hand. The five non-negotiable rules live in [`CONTEXT.md`](./CONTEXT.md); per-agent operating instructions live in [`AGENTS.md`](./AGENTS.md).

Install the upstream skill pack once:

```bash
npx skills add https://github.com/mattpocock/skills
```

Engineering skills available after install: `grill-me`, `grill-with-docs`, `tdd`, `diagnose`, `triage`, `to-issues`, `to-prd`, `request-refactor-plan`.

AWIP-specific skills live in [`docs/agents/`](./docs/agents/):

- [`awip-core-rules`](./docs/agents/awip-core-rules.md) — recap the five Core rules before any API or schema change.
- [`awip-module-register`](./docs/agents/awip-module-register.md) — correct flow for registering a new module/capability.

Invoke a skill by referencing it in your prompt, e.g. *"Use `awip-core-rules` and `tdd` to add the new `/okr/archive` endpoint"*.

## Related projects

- **Discovery AI** (separate Lovable project) — calls `GET /capabilities` during drafting and `POST /okr/ingest` to hand off finished trees
- **Control Plane** — currently embedded in this project at `/control-plane`. Will likely move to its own Lovable project when the first acting module ships

## CI / nightly tests

The nightly workflow (`.github/workflows/nightly.yml`) runs vitest unit + e2e suites at 02:00 UTC and posts a summary to the `record-test-run` edge function so results show up on `/roadmap` (Automation card) and `/runbook`. See [docs/automation.md](docs/automation.md) for the full pipeline.

That POST is authenticated with the same `AWIP_SERVICE_TOKEN` used by the API. Until the token is configured as a GitHub Actions secret, the workflow will run but the report step will fail with `401 unauthorized`.

### One-time setup

1. Copy the existing `AWIP_SERVICE_TOKEN` value from Lovable Cloud → Project settings → Secrets.
2. In GitHub: **Repo → Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `AWIP_SERVICE_TOKEN` — Value: paste the token from step 1. Save.
4. Trigger a run to verify: **Actions → Nightly tests → Run workflow**, then check `/roadmap` for the new entry under **Tests**.

### Rotating the token

If you rotate `AWIP_SERVICE_TOKEN` in Lovable Cloud, update the GitHub Actions secret with the same name — no workflow change needed.
