## Split commit: (a) phases & sprints now, (b) s2.6 tasks later

Two migrations, run in order. (a) lands the structural skeleton so `/roadmap` and `/master-plan` stop lying. (b) is held back so we can re-scope s2.6 in chat before it becomes "real work".

---

### Migration A — Phases, sprints, housekeeping (run now)

**1. Insert missing phases** (`roadmap_phases`, all `status='planned'` except where noted):

| key | order | title | summary |
|---|---|---|---|
| phase-5 | 5 | Entity & Tenant Resolution | Canonical entity model, alias resolver, tenant_node graph. Foundation for ingest. |
| phase-6 | 6 | Ingest & Canonicalisation | Source adapters, conflict detection, supersede semantics, idempotent writes. |
| phase-6b | 6.5 | Ingest Observability | Per-source dashboards, conflict review UI, replay. Splits cleanly from 6 build-out. |
| phase-7 | 7 | Connector Marketplace | Third-party capability connectors, manifest validation, install/uninstall flow. |
| phase-9 | 9 | Multi-tenant Hardening | Per-tenant RLS audit, quota, isolation tests, tenant admin surface. |
| phase-11 | 11 | Public API & SDK | Stable contract surface, versioning, generated SDK, docs site. |

(Phase 8 / 10 intentionally left as gaps — reserved for OKR-driven slots once Phase 4 produces signal. Documented as "reserved" in summary of phase-7 / phase-9.)

**2. Seed one placeholder sprint per new phase** (`roadmap_sprints`, `status='planned'`, `order=1`):

| sprint key | phase | title | goal |
|---|---|---|---|
| s5.1 | phase-5 | Entity model + alias resolver | Schema + `resolve_entity()` SDF, no UI yet. |
| s6.1 | phase-6 | Canonical ingest spine | Source adapter contract, conflict table, supersede rules. |
| s6b.1 | phase-6b | Conflict review surface | Operator UI for unresolved conflicts + replay. |
| s7.1 | phase-7 | Connector manifest v1 | Manifest schema, validator, install dry-run. |
| s9.1 | phase-9 | Tenant isolation audit | RLS sweep + per-tenant fuzz tests. |
| s11.1 | phase-11 | Contract freeze v1 | Pin awip-api surface, version header, deprecation policy. |

**3. Insert s2.6 sprint shell only** (no tasks — that's Migration B):
- `s2.6` under phase-2, `status='planned'`, title "Loop-task triage + promotion", goal "Promote outcome-shaped loop tasks to notebook; snapshot full loop into work_log."

**4. Cross-link pinned notebook open-questions to their phase's first sprint** as `roadmap_comments` (`kind='comment'`, `author='system'`, `resolved=false`, body = `"Open question from notebook: <title> — see /notebook?id=<uuid>"`). One comment per pinned `notebook_entries` row whose tags contain `phase-N`, attached to the first task of `sN.1` — except there are no tasks yet, so attach to a sentinel task we create per sprint titled "Open questions" (status `todo`, order 0). This keeps the FK happy and gives operators a visible inbox per phase.

**5. Resolve 2 stale notebook entries** (Telegram move s2.2, Voice model phase-4) → `status='resolved'`. (data update via insert tool, not migration.)

**Acceptance for A:**
- `/master-plan` renders 11 phases (with gaps at 8, 10) in order.
- Each new phase shows exactly one sprint with one "Open questions" task.
- Pinned notebook questions appear as comments on the matching sentinel task.
- Notebook shows 0 stale Telegram/voice entries in `open`.

---

### Migration B — s2.6 task wiring (held back, re-scope first)

Drafted but **not run** until you re-scope. Current draft = the 4 tasks from the approved triage-promotion plan:

1. `s2.6 t1` — Add phase-keyword map + `classifyLoopTask()` helper.
2. `s2.6 t2` — Promote qualifying loop tasks to `notebook_entries` (auto-promoted tag, gated by triage rule).
3. `s2.6 t3` — Add `task_snapshot jsonb` column to `roadmap_work_log`; serialise full loop on every turn.
4. `s2.6 t4` — Render "Turn N — task plan" collapsible on roadmap work-log entries; add "Auto-promoted" filter chip + bulk archive on Notebook.

**Why split:** t3 is a schema change (`ALTER TABLE roadmap_work_log ADD COLUMN task_snapshot jsonb`). Worth confirming you still want full snapshot vs. just the promoted subset before we commit a column. t4 also touches two pages — easy to descope to just the Notebook chip.

**What I need from you before running B:**
- Keep all 4, or drop any? (Most likely candidate to drop: t4's roadmap render — Notebook chip alone may be enough.)
- `task_snapshot` = full loop (every task incl. scaffolding) or only promoted ones?

---

### What does NOT happen in either migration

- No edits to `auth`, `storage`, `realtime`, or other reserved schemas.
- No backfill of historical turns into `task_snapshot`.
- No auto-creation of `roadmap_tasks` from loop tasks (notebook only).
- No changes to existing Phase 1–4 rows.
- `.lovable/plan.md` and `docs/master-plan.md` updated in the same commit as Migration A so docs match DB.

### Technical notes

- Both migrations are pure SQL via the migration tool; data updates (stale notebook resolution, sentinel-task comments) go through the insert tool per the standing rule.
- All new rows inherit existing operator-only RLS on `roadmap_phases` / `roadmap_sprints` / `roadmap_tasks` / `roadmap_comments` — no policy changes needed.
- Sentinel "Open questions" tasks use `key='open-questions'` per sprint so they're easy to filter out of progress counts later.
