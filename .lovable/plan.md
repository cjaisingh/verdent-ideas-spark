
# Global Scheduling Substrate (W8.1) — Core + FM

## Goal
One scheduler in Core that any module (Core, FM1–FM12) can enqueue against, with handlers running either in-Core (local) or in the owning FM project (remote). Operator-visible UI, tenant-scoped for FM jobs, reuses existing per-module token + heartbeat machinery.

## Non-goals
- Not replacing high-frequency pg_cron pollers (`sentinel-tick`, `ci-status-sync-30m`, `overnight-phase-runner-15m`).
- Not building email/SMS delivery — Telegram + operator inbox only in v1.
- Not auto-migrating existing 19 `scheduled-*` crons in this pass (separate lane).
- Not a workflow engine / DAG — single-step jobs only.
- Not building FM1–FM12 callback endpoints themselves — Core ships the contract + reference handler stub.

## Blast radius & rules cited
- **New tables (public, operator-only RLS via `has_role`)**:
  - `scheduled_jobs` — the queue
  - `scheduled_job_events` — audit trail (every state change)
  - `module_endpoints` — per-module callback URLs (for remote dispatch)
  - `external_contacts` — net-new entity for non-tenant clients/prospects
- **New edge fns** (Core): `scheduler-tick` (1-min cron), `scheduler-enqueue` (write API for operator + FM service tokens).
- **Reused**: `module_service_tokens` + `resolve_module_token()` (already exists per `mem://features/module-contracts`); `tenant_nodes` for subject scoping; `discussion_actions` + `telegram-send` for notification rails.
- **New surface**: `/admin/scheduler` (list/filter/create/cancel/retry), reminder panels on tenant detail + `/contacts/:id`.
- **Core rules cited (`CONTEXT.md`)**:
  - "Substrate, not a brain" — Core dispatches by `kind`; never decides *what* to schedule.
  - "No who-acts-when routing in Core" — handler lookup is a flat registry; no branching on tenant/capability/owner.
  - Every mutation emits an `*_events` row (`scheduled_job_events`).
- **ADRs cited**: extends 0002 (service-token + idempotency — `dedupe_key` mandatory). Touches 0001 (capability registry contract) via `module_endpoints`.
- **FM-AI failure mode defused**: silent drift / forgotten work — closes the gap that prompted this conversation. Also closes the cross-module variant: FM modules silently failing to run scheduled work because they each rolled their own cron.

## Alternatives considered
1. **Status quo (per-consumer pg_cron + bespoke tables)**. Rejected: doesn't generalise to FM projects at all — each FM would re-invent the wheel.
2. **Inngest / Temporal / Trigger.dev**. Rejected: new vendor, credit burn, sovereignty regression (`mem://preferences/sovereignty-posture`), overkill for single-step jobs.
3. **Core-dispatch-only (A)** — every kind remote, even Core's own. Rejected: Core calling itself over HTTP for `report.weekly_digest` is wasteful and adds an auth hop where there's no trust boundary.
4. **Federated (B)** — each FM runs its own tick + table. Rejected: no cross-module reminder UI, duplicated machinery × 12, operator can't see one queue.
5. **Chosen: Hybrid (C)** — Core hosts table + UI + tick. `scheduled_jobs.handler_kind` is `local` or `remote`. Local handlers live in `_shared/scheduler-handlers.ts`; remote handlers POST to `module_endpoints[owning_module].callback_url` with the module's signed service token and `Idempotency-Key`. Mirrors the `awip-api` pattern operators already understand.

Sub-decisions:
- **Reuse `module_service_tokens` rather than mint scheduler-specific tokens** — one secret per module across registration + heartbeat + scheduler callbacks. `capability-architect` persona endorsed.
- **Tenant_id is a column on `scheduled_jobs`, enforced by trigger** (not a separate join table) — when `owning_module != 'awip_core'`, `tenant_id` must be non-null. Trigger `enforce_fm_tenant_scope`.

## Contract
`supabase/functions/_shared/contracts/scheduler.ts`:

```ts
export type SchedulerJobInput = {
  kind: string;                    // e.g. 'reminder.send', 'report.weekly_digest',
                                   //      'fm1.stakeholder_pulse', 'rationalisation.lane_eligible'
  run_at: string;                  // ISO UTC
  recurrence?: string | null;      // 5-field cron expr; null = one-shot
  payload: Record<string, unknown>;
  dedupe_key: string;              // REQUIRED, UNIQUE per (owning_module, dedupe_key)
  owning_module: string;           // 'awip_core' | 'fm1' | ... | 'rationalisation'
  tenant_id?: string | null;       // REQUIRED when owning_module != 'awip_core'
  subject_type?: 'operator' | 'tenant' | 'external_contact' | null;
  subject_id?: string | null;
  max_retries?: number;            // default 3
};

export type SchedulerHandlerResolution =
  | { mode: 'local'; handler: SchedulerHandler }
  | { mode: 'remote'; module: string; callback_url: string };

export type SchedulerHandler = (job: ScheduledJobRow) => Promise<
  | { status: 'done'; result?: unknown }
  | { status: 'failed'; error: string; retryable: boolean }
>;
```

**Remote dispatch shape** (POST from `scheduler-tick` to `module_endpoints.callback_url`):
```
Headers:  x-awip-service-token: <module token>
          Idempotency-Key: <job.id>:<attempt>
Body:     { kind, payload, tenant_id, subject_type, subject_id, attempt, deadline_at }
Reply:    200 { status: 'done', result?: any }
          409 { status: 'duplicate' }      (treat as done)
          5xx                              (retryable)
          4xx                              (terminal)
```

`module_endpoints` row: `module text PRIMARY KEY, callback_url text, registered_at, last_dispatch_ok_at, last_dispatch_err_at, last_error text`. FM registers via `POST /modules/heartbeat` extension or a new tiny `POST /modules/register-endpoint`.

## Persona sign-off
- **event-engineer**: trigger on `scheduled_jobs` UPDATE writes `scheduled_job_events(prev_status, new_status, actor, attempt, error)`.
- **tenant-manager**: `enforce_fm_tenant_scope` trigger + RLS policy `scheduled_jobs_fm_tenant_isolation` (FM jobs only visible to operators with tenant access). On tenant revoke → cascade cancel.
- **compliance-auditor**: operator-initiated cancel/edit requires JWT (not service token); recurrence changes emit a separate `recurrence_changed` event.
- **sentinel** (new checks):
  - `scheduled_jobs_stuck` (medium): any `running` >10min or `pending` with `run_at < now()-5min`.
  - `scheduler_dlq_growth` (high): >20 `failed` in 24h.
  - `module_endpoint_silent` (medium): `last_dispatch_ok_at < now()-7d` for an endpoint with pending jobs.
  - `module_endpoint_red` (high): `last_dispatch_err_at > last_dispatch_ok_at` for 1h with ≥3 attempts.
- **control-plane-operator**: `scheduler-tick` does only `HANDLERS[kind]` lookup OR `module_endpoints[owning_module]` lookup — no branching on capability id, KR id, or tenant. New kinds = new handler file or new FM endpoint; never a tick edit.
- **capability-architect**: `module_endpoints.module` FK-soft-references `capabilities.owning_module` distinct set; warning (not block) if endpoint registered for unknown module.
- **demand-analyst**: requires `kind` to appear in `scheduler_kind_catalog` (seed table, free-form add) so operator UI can show what's used vs dead-weight.

## Gap checklist
- [x] Idempotency: `UNIQUE (owning_module, dedupe_key)`; re-enqueue returns existing job id.
- [x] Events: `scheduled_job_events` trigger on every state change.
- [x] RLS: operator-only on all 5 new tables via `has_role(auth.uid(), 'admin')`. FM tenant-scoped subset enforced.
- [x] GRANTs: `authenticated` + `service_role` on every new public table; no `anon`.
- [x] Realtime: enable for `scheduled_jobs` (live `/admin/scheduler`).
- [x] Observability registry: add 6 rows (`scheduler-tick`, `scheduler-enqueue`, 4 sentinel checks).
- [x] `withLogger` on both new edge fns.
- [x] No new `any` — contracts file strict.
- [x] Memory: `mem://features/scheduler.md` + index entry + add to Core rule list.
- [x] CHANGELOG + new `docs/scheduler.md`.
- [x] FM scaffold updated (`docs/module-scaffold/`) to show how to register a callback endpoint.

## Test plan
- **vitest unit** `src/lib/scheduler.test.ts` — recurrence parsing, subject validation, FM tenant requirement.
- **deno** `supabase/functions/scheduler-enqueue/_test/enqueue.test.ts` — happy path, duplicate dedupe returns same id, FM job without tenant_id → 400, FM job with wrong module token → 403.
- **deno** `supabase/functions/scheduler-tick/_test/dispatch.test.ts` — claims due jobs, local handler success, remote handler 200/409/5xx/4xx all handled correctly, attempt backoff, DLQ at max_retries.
- **curl_edge_functions** smoke after deploy: enqueue + tick + verify event log.
- **e2e** `e2e-playwright/scheduler.spec.ts` — operator creates reminder for a tenant, sees it on `/admin/scheduler`, cancels, sees event row.
- **handler smoke** `reminder.send` posts to telegram-send and writes `discussion_actions` row.

## Validation gates
```
bun run lint:ratchet
bun run rls:verify
bun run scripts/check-logger-coverage.ts        # 70/70
bunx vitest run src/lib/scheduler.test.ts
bunx vitest run supabase/functions/scheduler-*/_test/*.test.ts   # via deno test runner
curl_edge_functions scheduler-enqueue (x2 same dedupe → same id)
curl_edge_functions scheduler-enqueue (FM payload, no tenant → 400)
curl_edge_functions scheduler-tick (after seeding past-due test job → status flips to done, event written)
bunx playwright test scheduler.spec.ts
```
Plus 24h watch on the 4 new sentinel checks before declaring v1 stable.

## Build sequence
1. Migration #1: `scheduled_jobs`, `scheduled_job_events`, `module_endpoints`, `external_contacts`, `scheduler_kind_catalog` — GRANTs + RLS + triggers + realtime publication.
2. Contract file + handler registry skeleton + remote-dispatch helper.
3. `scheduler-enqueue` edge fn (operator JWT + module service token paths).
4. `scheduler-tick` edge fn + pg_cron row `scheduled-scheduler-tick`.
5. 3 reference handlers: `reminder.send` (local), `report.weekly_digest` (local), `rationalisation.lane_eligible` (local).
6. Tiny `POST /modules/register-endpoint` on `awip-api` for FM callback registration.
7. `/admin/scheduler` page (list + filters by module/tenant/status + create modal + cancel/retry).
8. Reminder panel component, embedded on tenant detail + new `/contacts/:id`.
9. 4 sentinel checks + observability_registry rows.
10. FM scaffold doc update + `docs/module-scaffold/register-endpoint/` example.
11. Backfill Lane 2 self-scheduling: enqueue `rationalisation.lane_eligible` for Lane 2 at Lane 1 merge + 24h (solves the original complaint).
12. Docs (`docs/scheduler.md`, `docs/why-awip.md` footnote, ADR-0010 stub if needed) + memory + CHANGELOG.

## Out of scope (footer — will be POSTed to plan-footer-ingest on done)
- Email/SMS delivery rails (defer until external_contacts proves out).
- Migration of existing 19 `scheduled-*` pg_cron jobs to the new substrate (separate lane — keep both rails running for now).
- Client-self-service reminder portal (operator-only in v1).
- Workflow chaining / DAGs / fan-out jobs.
- Timezone-aware recurrence (UTC only v1).
- FM1–FM12 callback handler implementations (each FM's own project ships those).
- Auto-discovery of FM endpoints (manual `POST /modules/register-endpoint` v1).
