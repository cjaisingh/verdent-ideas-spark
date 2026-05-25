## Goal
Capture the three Klarity takeaways as durable AWIP work. Implement only the OKR-adjacent **value layer** now (where it pays off immediately); placeholder the other two as ideas + doc stubs so they aren't lost.

## Non-goals
- No screen/audio capture pipeline.
- No flow ontology beyond a stub file.
- No UI changes to `/okr`, `/roadmap`, or Morning Review in this slice — columns only, surfaces follow.
- No Advisor recommender. We're only making the framing *possible*.

## Blast radius & Core rule cited
- Tables: `public.okr_nodes` (+ event), `public.discussion_actions` (+ event), `public.roadmap_tasks` (+ activity).
- Surfaces touched: none yet (read paths unchanged; new columns are nullable).
- **Core rule:** *"Every OKR mutation → `okr_node_events`; every manifest change → `capability_events`."* Adding `projected_value_usd`/`realized_value_usd` to OKR nodes is an OKR mutation surface — the existing `emit_okr_node_event` trigger must capture it.
- **ADR:** ADR-0003 (OKR-driven execution) — value framing is the natural completion of "measure against outcomes, not output."
- **FM-AI:** addresses "AI optimises against unmeasured surrogates" — without a $-anchored signal, recommenders rank by activity, not impact.

---

## Alternatives considered

**A. Value on `discussion_actions` only** (mirror Klarity's Advisor exactly).
Pros: simplest, sits where the Advisor would read.
Cons: actions are short-lived; value belongs on the *outcome* (KR), not the to-do. Aggregation would double-count.

**B. Value on `okr_nodes` (KRs) + optional override on `discussion_actions`** ← **chosen**.
Pros: KR is the canonical home of "what's this worth?"; existing `roadmap_tasks.okr_node_id` FK lets us roll a task's contribution up for free. Action-level override stays available for one-off items not tied to a KR.
Cons: two columns in two places; needs a clear rule ("KR is authoritative; action value only used when `okr_node_id IS NULL`").

**C. New `okr_value_estimates` table with history.**
Pros: full audit of estimate revisions.
Cons: premature — `okr_node_events` already captures every column change. Revisit if/when forecasting needs a separate timeline.

---

## Contract
No new cron, edge function, or agent loop. Schema-only slice. The `okr-ingest` contract already accepts arbitrary node fields — the new columns flow through automatically.

## Persona sign-off
- **okr-strategist** — KR is the right home for value; trigger already emits on column change, no new event work needed.
- **event-engineer** — verify `emit_okr_node_event` payload includes the new columns (it serialises `NEW` row, so yes by default).
- **compliance-auditor** — nullable columns, no phase-gate change, no RLS change. Pass.
- **demand-analyst** — explicitly wanted: "value side is blank." This fills it.
- **product-historian** — needs CHANGELOG + memory rule that `projected_value_usd` is operator-authoritative, never AI-written without operator approval.

## Gap checklist
- [x] Idempotency: column ADD is naturally idempotent under `IF NOT EXISTS`.
- [x] `*_events` emission: existing OKR + discussion-action triggers cover it.
- [x] RLS: no policy change (operator-only writes already enforced via service role).
- [x] Realtime: no publication change needed (existing tables already on `supabase_realtime`).
- [x] `observability_registry`: N/A (no new surface).
- [x] `withLogger`: N/A (no new fn).
- [x] No new `any`: types regenerate from schema.
- [x] Mem rule: add `mem://features/okr-value-layer.md`.
- [x] CHANGELOG entry.
- [x] Doc: `docs/master-plan.md` Phase-okr note + new `docs/okr-value-layer.md` (one page).

## Test plan
- **vitest:** add `src/lib/okrValue.test.ts` covering a `rollupActionValue(action, kr)` helper — returns KR value when linked, action override otherwise, null when neither set. Failing test first.
- **migration smoke:** `psql -c "select projected_value_usd from okr_nodes limit 0"` post-migration.
- **trigger check:** insert→update a `okr_nodes` row with new column, assert latest `okr_node_events.payload` contains both new fields.
- No e2e — no UI surface yet.

## Validation gates
- `bun run lint:ratchet` — green.
- `bunx vitest run src/lib/okrValue.test.ts` — green.
- `supabase--read_query` on `okr_node_events` proving new fields land in payload.
- `bun run rls:verify` — green (no policy delta expected).

---

## Placeholders (lessons 1 & 2 — not built now)

### Lesson 1: Flow ontology
- Create `docs/ontology-flows.md` **stub only** — title, intent, and TODO list of 6 candidate flows (operator-day, phase-loop, night-shift, morning-review, audit-cycle, quarterly-review). No schema, no /ontology surface change.
- Log as `discussion_action` (source=`plan_footer`, risk=`low`, owner=operator) so it lives in the inbox.

### Lesson 2: Capture surface (record-and-go companion)
- Pure `discussion_action`, no doc, no code. Title: *"Investigate screen+audio capture mode for Companion (Klarity-style)."* Risk=`low`, blocked on Phase 6 (canonical_facts) landing.

Both placeholders are operator-priority calls later — the value-layer slice unblocks them by giving any future recommender a $-axis to rank against.

---

## Out of scope
- Advisor recommender that emits "do X for +$Y".
- Surfacing `projected_value_usd` on `/okr`, `/roadmap`, or Morning Review.
- Backfilling existing KRs with values (operator does this manually).
- Multi-currency (USD only; add `currency` column when a non-USD KR appears).
- Flow ontology beyond stub.
- Screen-capture pipeline.
