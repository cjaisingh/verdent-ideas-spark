
## Goal
Make the AWIP constellation diagram **observably true** in the database: the 7 apex client-goal Objectives exist as canonical top-level `okr_nodes`, and FM1 (Stakeholder Intelligence) is registered as the first real capability-producing module — proving the `register → demand → events` loop end-to-end.

## Non-goals
- No FM2–FM12. One module proves the path; the rest follow on operator demand.
- No new UI on `/okr` or `/capabilities` — read paths already render whatever is seeded.
- No flow ontology promotion (parked; needs real FM1 traffic first).
- No KR seeding under the 7 Objectives — operator authors KRs as real targets emerge. Empty Objectives are intentional placeholders, not stubs to backfill.
- No Control Plane routing. Core stays substrate.

## Blast radius & Core rule / ADR / FM-AI cited
- **Data writes (no schema change):** 7 rows into `public.okr_nodes` (level=`objective`, parent_id=NULL), 1 row into `public.capabilities`, ≥1 row into `public.capability_events` via existing trigger.
- **Surfaces touched:** `/okr` (renders new Objectives), `/capabilities` (renders FM1), `/capabilities/demand` (FM1 demand=0 until a KR cites it).
- **Files touched:** `docs/module-scaffold/capabilities.json` (reference example), new `mem://features/fm1-stakeholder-intelligence.md`, `CHANGELOG.md`, `mem://index.md`.
- **Core rule cited:** *"Every OKR mutation → `okr_node_events`; every manifest change → `capability_events`."* Both fire automatically from existing triggers on the seed inserts — verify, don't reimplement.
- **ADR cited:** ADR-0001 (Capability registry contract) — FM1 self-registers via `POST /capabilities/register`, no special path. ADR-0003 (OKR-driven execution) — apex Objectives complete the tree's top.
- **FM-AI failure mode:** #1 *"AWIP is talking to itself"* — empty constellation. Defused by making at least one module real and at least the apex outcomes namable.

---

## Alternatives considered

**A. Seed all 12 FMs as empty capability stubs.**
Pros: diagram matches DB on day 1.
Cons: fake demand, dead-weight rows the `demand-analyst` persona would flag immediately. Violates "no speculative capabilities."

**B. Seed apex Objectives only, no module.** 
Pros: zero risk; pure data.
Cons: doesn't prove the constellation works. Core stays talking to itself — exactly the failure mode the picture is meant to defuse.

**C. Seed apex Objectives + register FM1 via the real `POST /capabilities/register` contract path, dry-run with operator approval.** ← **chosen**
Pros: exercises the live contract (Idempotency-Key, service token, `capability_events` emission); FM1 becomes a reference example for future modules; demand stays honestly 0 until a KR is authored. Proves the loop without lying about traffic.
Cons: FM1 is registered but does nothing yet — that's fine, it's a manifest entry, not a running service. Operator must understand "registered" ≠ "shipping."

**D. New `fm_modules` table separate from `capabilities`.**
Discarded — would fork the manifest. FM1–FM12 are *bundles* of capabilities, not a new entity. Use `capabilities.id` prefix convention (`fm1.*`) and a `module` tag.

---

## Contract
No new cron, edge fn, or agent loop. FM1 registration uses the **existing** `POST /capabilities/register` contract on `awip-api` (ADR-0001). Apex Objective seeds use the **existing** `okr_nodes` insert path with existing `emit_okr_node_event` trigger. No `_shared/contracts/*.ts` file needed.

Idempotency: both inserts use `ON CONFLICT (id) DO NOTHING` patterns so re-running the seed is safe.

## Persona sign-off
- **okr-strategist** — apex Objectives have no parent (correct for level=`objective`), no KRs yet (correct: KRs come from real targets, not aspiration). `okr_node_events` fires via existing trigger on insert. ✅
- **capability-architect** — FM1 registered through the live contract, not a side-channel insert. `capability_events.registered` will land. Uses `module=fm1` tag for grouping. ✅
- **demand-analyst** — explicitly accepts FM1 demand=0 at seed time. Will flag if it stays 0 after 60d with no KR citing it. ✅
- **event-engineer** — verify both event tables get rows post-seed; no new event surface required. ✅
- **compliance-auditor** — no RLS change, no gate change, operator-only writes via service role. ✅
- **product-historian** — needs CHANGELOG entry + memory rule that the 7 apex Objectives are git-versioned (changes go through migration, not UI) and that FM1 is the **reference module** future FMs copy. ✅
- **tenant-manager** — apex Objectives are Core-level, not tenant-scoped (correct: they're the platform's own OKRs). FM1 is platform-tier capability. No tenant FK. ✅

## Gap checklist
- [x] Idempotency: `ON CONFLICT DO NOTHING` on both seeds; capability register uses Idempotency-Key.
- [x] `*_events` emission: existing `emit_okr_node_event` + capability trigger cover it. **Verify post-seed** with `read_query`.
- [x] RLS: no policy change.
- [x] Realtime: `okr_nodes` + `capabilities` already on `supabase_realtime`.
- [x] `observability_registry`: N/A (no new surface).
- [x] `withLogger`: N/A (no new fn).
- [x] No new `any`: data-only change; types regenerate.
- [x] Mem rule: `mem://features/fm1-stakeholder-intelligence.md` + index entry; note in `mem://features/ontology.md` that apex Objectives are git-versioned.
- [x] CHANGELOG entry: "Apex Objectives seeded + FM1 registered as reference module."
- [x] Doc: update `docs/module-scaffold/README.md` to point at FM1 as the worked example.

## Test plan
- **vitest (unit):** none — pure data seed, no new helper.
- **edge fn (curl):** `curl_edge_functions awip-api POST /capabilities/register` with FM1 payload + Idempotency-Key. Assert 200 first call, 200-noop second call (same key + body), 409 on key reuse with different body.
- **read_query verification (4 checks):**
  1. `select count(*) from okr_nodes where parent_id is null and level='objective'` → 7.
  2. `select count(*) from okr_node_events where okr_node_id in (...seeded ids)` → ≥7.
  3. `select * from capabilities where id like 'fm1.%'` → ≥1 row.
  4. `select * from capability_events where capability_id like 'fm1.%' and event='registered'` → ≥1 row.
- **e2e:** none — `/okr` and `/capabilities` are read-only render paths already covered by existing tests.

## Validation gates
- `supabase--insert` on the 7 Objectives succeeds (operator approves).
- `curl_edge_functions` FM1 register returns 200 + idempotency holds.
- 4 `read_query` assertions above all pass.
- `bun run lint:ratchet` — green (no code change expected to move the baseline).
- `bun run rls:verify` — green (no policy delta).
- Operator visually confirms `/okr` shows 7 apex rows and `/capabilities` shows FM1.

---

## Execution order (once approved)
1. `supabase--insert` 7 apex Objectives with deterministic UUIDs derived from slugs (`operational-excellence`, `cost-efficiency`, `risk-reduction`, `workplace-experience`, `sustainability-esg`, `compliance-confidence`, `growth-value-creation`).
2. `curl_edge_functions` register FM1 with capabilities: `fm1.stakeholder.profile`, `fm1.stakeholder.engagement_signal`, `fm1.stakeholder.sentiment_pulse` (3 to start — enough to be real, few enough to be honest).
3. Run the 4 verification queries.
4. Write `mem://features/fm1-stakeholder-intelligence.md`, update index, update CHANGELOG, update `docs/module-scaffold/README.md`.
5. POST plan footer + session summary per `awip-session-lifecycle`.

---

## Out of scope
- FM2–FM12 registration (one module at a time, demand-driven).
- KRs under the 7 Objectives — operator authors when real targets exist.
- Promoting `docs/ontology-flows.md` from stub (needs FM1 traffic first; logged as `discussion_action` already).
- An actual FM1 service — this slice registers the manifest entry only. The running module ships as a separate Lovable project later.
- Seeding any apex Objective with target metrics (premature; would force fake baselines).
- `/capabilities` UI work to group by `module=fm*` tag (defer until ≥2 FMs exist).
- Removing the FM1 entry from the diagram-side documentation (`docs/why-awip.md`) — not needed, diagram already names it.
