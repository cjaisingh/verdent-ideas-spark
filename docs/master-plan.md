# Master Plan

The single source of truth for what we are building, why, and in what order. The live state of execution is tracked at `/roadmap` (backed by `roadmap_phases`, `roadmap_sprints`, `roadmap_tasks`).

## Vision

A modular, capability-driven operator platform: every business function is a registered capability with explicit inputs, outputs, owning module, approvals, and observability. Operators steer the system through approvals, comments, and a roadmap that doubles as a real-time control plane.

## Phases

### Phase 1 — Foundations (done)
**Purpose.** Stand up the capability registry, approvals queue, operator messaging (Telegram), API logging, and core RLS-secured tables.
**Success criteria.** Capabilities are listable; approvals can be raised, decided, and replayed idempotently; operator can talk to the system over Telegram; every API call is logged with redaction.

### Phase 2 — Operator Channel & Roadmap (active)
**Purpose.** Give the operator a first-class control surface: roadmap with phases/sprints/tasks, inline editing, comments, and a per-task work log capturing duration, tokens, and issues/fixes.
**Success criteria.** Operator can plan, edit, comment, and review AI work without leaving `/roadmap`. Every AI session leaves a trail.

### Phase 3 — Module Scaffold & Capability Maturation
**Purpose.** Promote the documented module scaffold (`docs/module-scaffold/`) into the registry; add capability versioning, dependency graph, and connector wiring.
**Success criteria.** New modules can be added by following the scaffold and appear in `/capabilities` with their capability tree and connectors.

### Phase 4 — OKR-Driven Execution
**Purpose.** Tie roadmap tasks to `okr_nodes` and `okr_measurements` so progress is measured against outcomes, not output.
**Success criteria.** Every active sprint links to one or more OKRs; measurements update task health automatically.

### Phase 5 — Entity & Tenant Resolution (planned)
Canonical entity model, alias resolver, tenant_node graph. Foundation for ingest.

### Phase 6 — Ingest & Canonicalisation (planned)
Source adapters, conflict detection, supersede semantics, idempotent writes.

### Phase 6b — Ingest Observability (planned)
Per-source dashboards, conflict review UI, replay.

### Phase 7 — Connector Marketplace (planned)
Third-party capability connectors, manifest validation, install/uninstall flow. *(Phase 8 reserved — OKR-driven slot once Phase 4 produces signal.)*

### Phase 9 — Multi-tenant Hardening (planned)
Per-tenant RLS audit, quota, isolation tests, tenant admin surface. *(Phase 10 reserved — OKR-driven slot.)*

### Phase 11 — Public API & SDK (planned)
Stable contract surface, versioning, generated SDK, docs site.

## Module map

- **awip-api** — central capability invocation surface (edge function)
- **operator_channel** — Telegram + roadmap + approvals UI
- **capability registry** — `capabilities`, `capability_connectors`, `capability_events`
- **observability** — `api_call_logs`, `telegram_gateway_logs`, `roadmap_work_log`
- **governance** — `user_roles`, `role_change_audit`, `activity_policies`, `approval_queue`

See `docs/modules.md` for current module boundaries and `docs/architecture.md` for system shape.

## Decisions

ADRs live in `docs/adr/`. Notable:
- ADR-0001 — Capability registry contract
- ADR-0002 — Service token & idempotency

## Working agreements

- Every AI work session against a roadmap task logs `started_at`, `ended_at`, `duration_ms`, `tokens_*`, plus a one-line summary and any issues/fixes (table: `roadmap_work_log`).
- Every epic (phase) has a one-paragraph summary visible on the roadmap.
- UK English in all user-facing copy.
