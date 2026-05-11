
# AWIP 30-Day Program: Stabilize → Harden → Commercialize

Four phases, one per week. Each week delivers shippable artifacts and ends with a checkpoint. **No new agents, no new dashboards, no new AI surfaces** until Week 3.

---

## Guiding rules (apply to every week)

1. **Discipline over creativity.** No feature outside this plan. Anything new goes to `discussion_actions` with `risk='low'` and is deferred.
2. **Evidence is immutable.** Narratives can reference but never overwrite.
3. **Every change is auditable.** Schema, cron, RLS, and ontology mutations log to `memory_audit_log`.
4. **Verification before "done".** Each deliverable has a check listed; if it can't be verified from the sandbox, say so.

---

## Week 1 — Stabilize the Foundation

### 1.1 Lock the ontology
**Source of truth:** `docs/ontology.md` (markdown, git-versioned).
**Surface:** `/ontology` page reads and renders it (no DB table, no editing UI yet).

11 entities, each with: **ownership · lifecycle (states + transitions) · mutation rules · authority source · audit table · relationships**.

| Entity | Authority | Audit table |
|---|---|---|
| task | `roadmap_tasks` | `roadmap_task_activity` |
| finding | `sentinel_findings` / `roadmap_findings` | `*_events` |
| lesson | `lessons` | append-only |
| approval | `discussion_actions` (status transitions) | `discussion_action_events` |
| event | `*_events` tables | self |
| discussion | `roadmap_finding_discussions` | `discussion_action_events` |
| workflow | cron jobs + edge fns | `cron.job_run_details` + logger |
| roadmap item | `roadmap_phases` / `roadmap_tasks` | activity tables |
| sign-off | `discussion_actions` w/ `status='shipped'` + reviewer | events |
| action | `discussion_actions` | events |
| review | `morning_reviews`, `deep_audits`, `awip_reviews` | self |

**Deliverables:** `docs/ontology.md`, `src/pages/Ontology.tsx`, nav link, memory entry `mem://features/ontology`.
**Check:** `/ontology` renders all 11 entities; each has all 6 fields populated.

### 1.2 Separate evidence / interpretation / narrative (HARD enforcement)
**New table:** `public.table_layers (table_name pk, layer enum('evidence','interpretation','narrative'), notes)`.

Seed it for every public table. Then:

- **RLS guard** on evidence tables: add policy `block_narrative_writes` using a SECURITY DEFINER fn `public.is_narrative_caller()` that checks a per-request GUC `app.caller_layer` (set by edge functions via `set_config`). If caller layer = `narrative`, deny `UPDATE/DELETE` on evidence rows (INSERT to append-only evidence still allowed).
- **Trigger guard** on evidence tables: `BEFORE UPDATE OR DELETE` raises if `current_setting('app.caller_layer', true) = 'narrative'`.
- **Edge function convention:** every fn declares its layer at top via `setCallerLayer(supabase, 'narrative'|'interpretation'|'evidence')` helper in `_shared/layer.ts`. Logger validation script extended to require it.

**Risk:** invasive — must inventory existing writes first. Mitigation: dry-run mode (log violations, don't block) for 48h before flipping to enforce.

**Deliverables:** migration, `_shared/layer.ts`, dry-run flag in `memory_settings`, audit query `select * from layer_violations_recent`.
**Check:** dry-run report shows zero violations from current code; flip to enforce; Sentinel watches `layer_violations` table.

### 1.3 Stabilize cron + events (full hardening)
Audit, then fix.

**Audit (read-only):**
- New page `/admin/cron-health` — for all 16 jobs: schedule, last 14 days runs, success rate, p95 duration, missed windows (gap > 1.5× schedule), idempotency-key coverage.
- Markdown report saved to `docs/audits/cron-health-W1.md`.

**Hardening:**
- Add `correlation_id uuid` + `parent_event_id uuid` + `caller_layer text` to every `*_events` table missing them.
- Edge functions: standard helper `withCorrelation(req)` that extracts/generates correlation id and propagates via `x-correlation-id` header to downstream invokes.
- Replay tool: `/admin/cron-health` row action "Replay" → calls fn with original payload + new correlation id, marks as `replay_of=<original_id>`.
- Deduplication: events get unique `(source, dedup_key)` index where `dedup_key` provided; helper rejects duplicates.

**Deliverables:** migration, `_shared/correlation.ts`, `/admin/cron-health` page, `docs/audits/cron-health-W1.md`.
**Check:** every event row from W1 onward has non-null `correlation_id`; replay produces a child event linked to parent.

### Week 1 checkpoint
- `docs/ontology.md` complete · `/ontology` live · layer enforcement in dry-run · cron-health page live · all event tables have lineage columns.

---

## Week 2 — Governance Hardening

### 2.1 Event taxonomy + severity model
**New table:** `event_types (key pk, layer, severity_default, dedup_strategy, escalation_after_count, escalation_window, description)`. Seed with every event type currently emitted.

`*_events.event_type` becomes FK to `event_types.key`. Severity column added: `info|notice|warn|error|critical`.

**Correlation/escalation rules** live in `event_types`:
- `dedup_strategy`: `none | by_correlation | by_subject_hour | by_subject_day`
- `escalation_after_count` + `escalation_window`: when threshold hit, auto-create `sentinel_finding` at next severity tier.

**Surface:** `/admin/event-taxonomy` (read + edit, operator only).

### 2.2 Operational state boundaries
Document and enforce six lanes: **planning · execution · review · governance · lessons · intelligence**.

Add `lane text` column to: `roadmap_tasks`, `roadmap_phases`, `discussion_actions`, `lessons`, `morning_reviews`, `deep_audits`, `sentinel_findings`. CHECK constraint to enum.

Cross-lane rule: a `discussion_action` in lane=execution cannot mutate a row in lane=governance without an `approval_event`. Enforced via trigger on `discussion_actions.UPDATE`.

`/ontology` page gains a "Lanes" tab showing the matrix.

### 2.3 Confidence architecture
Add to `findings`, `lessons`, `sentinel_findings`, `roadmap_findings`, `morning_reviews`, `awip_reviews`:
- `evidence_confidence numeric(3,2)` 0–1
- `operational_certainty numeric(3,2)` 0–1
- `traceability_score numeric(3,2)` 0–1 (computed: % of supporting events still resolvable)
- `validation_status enum('unvalidated','auto_validated','human_reviewed','disputed')`
- `human_reviewer uuid` + `human_reviewed_at`

UI badges everywhere these surface. Morning Review groups findings by validation_status.

### Week 2 checkpoint
- Event taxonomy seeded · severity propagating · lanes enforced · confidence visible on Morning Review and Sentinel pages.

---

## Week 3 — Productize the Discovery Engine

> Commercialization track starts here. Internal AWIP work this week is **maintenance only**.

### 3.1 Extract discovery primitives into `/discovery`
You already have: stakeholder interviewing, evidence ingestion, synthesis, requirements clustering, human review, output generation. Surface them as a **single guided flow** under `/discovery`:

1. **New engagement** form (client name, scope, stakeholders).
2. **Interview capture** (uses existing companion + Gemini TTS; transcripts → `discovery_evidence`).
3. **Synthesis** run (existing AI synthesis, scoped to engagement).
4. **Cluster review** (human accept/reject/edit).
5. **Output generation** (markdown report + optional PDF via `/mnt/documents`).

**New tables:** `discovery_engagements`, `discovery_evidence`, `discovery_clusters`, `discovery_outputs` — all in `interpretation` layer except `discovery_evidence` (`evidence`).

### 3.2 Consulting feedback loop
- Every engagement auto-creates a `lesson` candidate at close referencing what AWIP got wrong/right.
- `/discovery/engagements/:id/lessons` review surface; accepted lessons flow into existing weekly Lessons Loop.

### 3.3 Soft authority content
- `docs/case-studies/_template.md` + first stub.
- LinkedIn-post drafts under `docs/content/linkedin/` (3 drafts/week, no automation).

### Week 3 checkpoint
- `/discovery` runs end-to-end with a fake engagement · one case-study stub committed · 3 LinkedIn drafts ready.

---

## Week 4 — Controlled Expansion + Architecture Docs

### 4.1 Architecture documents (the missing brain)
Create under `docs/architecture/`:
- `00-overview.md` — system map
- `01-ontology-map.md` — entity diagram (mermaid)
- `02-lifecycle-maps.md` — state machines per entity (mermaid)
- `03-event-flow.md` — emission → correlation → escalation (mermaid)
- `04-governance-model.md` — lanes, approvals, sign-offs
- `05-operational-contracts.md` — `awip-api` endpoints, idempotency, auth
- `06-layer-enforcement.md` — evidence/interpretation/narrative

Render at `/architecture` (same pattern as `/ontology`).

### 4.2 Package the discovery offering
- `docs/discovery-offering.md` — pricing tiers, deliverables, timeline, exclusions.
- `docs/discovery-sow-template.md` — SOW template.
- One page on the public site: `/services/discovery`.

### 4.3 Controlled roadmap review
- Run a Deep Audit scoped to "feature explosion check": flag any open `discussion_action` not mapped to a documented capability or ontology entity.
- Output → `docs/audits/feature-discipline-W4.md`.
- Auto-create `discussion_actions` (risk=low) to retire or document each orphan.

### 4.4 AWIP governance hardening (final pass)
- Branch protection on `main` (manual: requires user action in GitHub).
- All cron jobs must reference an `event_type`; lint fails otherwise.
- All edge functions must declare a `lane`; logger-coverage script extended.

### Week 4 checkpoint
- 7 architecture docs live · `/architecture` page · discovery offering packaged · feature-discipline audit run · governance lints enforcing.

---

## Out of scope (explicit refusals)

- ❌ New agents beyond what exists
- ❌ New AI dashboards
- ❌ New operational layers beyond the 3 declared
- ❌ Any commercialization beyond Discovery (no AWIP sales yet)
- ❌ Any schema change not listed above

---

## Technical details (for implementation phase)

**Migrations (W1):** `table_layers`, `is_narrative_caller()`, layer policies on every evidence table, lineage columns on `*_events`, `replay_of` column.
**Migrations (W2):** `event_types`, FK + severity on events, `lane` columns + CHECK, confidence columns + `validation_status` enum.
**Migrations (W3):** 4 discovery tables.
**Edge functions:** `_shared/layer.ts`, `_shared/correlation.ts`; modify every existing fn to call both helpers (mechanical change, ~22 fns).
**New pages:** `/ontology`, `/admin/cron-health`, `/admin/event-taxonomy`, `/discovery/*` (5 sub-routes), `/architecture`.
**Logger script extension:** assert `setCallerLayer` and `withCorrelation` calls in every non-exempt fn.

**Verification matrix:**
| Deliverable | How to verify from sandbox |
|---|---|
| Ontology doc + page | `code--view docs/ontology.md` + visit `/ontology` |
| Layer enforcement | Insert test row from narrative-tagged fn → expect error |
| Cron lineage | `select count(*) from x_events where correlation_id is null and created_at > 'W1'` → 0 |
| Event taxonomy | All `*_events.event_type` resolve to `event_types.key` |
| Lanes | `select count(*) from discussion_actions where lane is null` → 0 |
| Discovery flow | Run with seed engagement, confirm output written to `/mnt/documents` |
| Architecture docs | 7 files exist + `/architecture` renders |
| CI mirror | Poll `cjaisingh/verdent-ideas-spark` runs after each push, link in checkpoint notes |

---

## What this plan refuses to promise

- I can't verify branch protection, GitHub Secrets, or CodeQL settings from the sandbox — those remain user actions.
- Consulting engagements / LinkedIn posting are calendar items, not code.
- "Stabilize" doesn't mean "zero failures" — it means **observable, replayable, deduplicated**.
