## Where we are

Just landed Phase 5/6/6b/7 prep scaffolding (retrieval contracts, source-adapter contract, ADR-0003..0006 stubs). Overnight runner now has shaped slots to fill.

Open board is thin:

| Action | Status | Notes |
|---|---|---|
| `ee7937ce` Replace ~480 `no-explicit-any` | in_progress | low/low, night-eligible |
| `ff5743f8` Disable CodeQL + dismiss 28 alerts | open | low/low, night-eligible |

Overnight queue (`run_overnight=true`): Phase 5, 6, 6b, 7 — all `planned`, waiting on the scaffolding we just shipped + an ADR-0006 decision before s6.2 can move.

## Four candidates

### A. Close CodeQL action (`ff5743f8`)
Disable GitHub default CodeQL setup, bulk-dismiss the 28 alerts with reason, log capability_event. ~20 min. Clears one of two open actions; no runtime risk.

### B. Drain `no-explicit-any` baseline (`ee7937ce`)
Run codemod-any-enqueue on a batched slice (e.g. 30–50 files), review the drafts, land the cleanest. Shrinks the 517-site budget. Mechanical, night-friendly — but better as overnight work than blocking foreground attention.

### C. Caprica vision branch
Wire photo `file_id` → Gemini 2.5 Flash vision → caption → route as text in `telegram-webhook`. Closes the documented inbox gap. Touches one edge fn + one helper. ~45 min including tests.

### D. Decide ADR-0006 (embedding model + index)
Promote `docs/adr/0006-embedding-model-and-index.md` from `proposed` → `accepted` with the lean (`gemini-embedding-001` @ 1536d + hnsw). This is the single decision that unblocks Phase 6 s6.2 (`canonical_facts` + ingest concierge embeddings). No code yet — just the ADR body, a CHANGELOG line, and a pgvector readiness note.

Without D, Phase 6 overnight runs will keep re-deriving the same question.

## Recommendation

**D, then A** in this session:
1. Fill out ADR-0006 — chosen option, rationale, consequences, rollout (extension enable + index choice at corpus thresholds), and the trigger to revisit (cost/quality at 100k chunks). Update `mem://features/phase-5-6-prep.md` lean → accepted.
2. Close CodeQL action (`ff5743f8`) — disable default setup via API or doc the manual step, bulk-dismiss with reason, emit capability_event, mark action `done`.

B (any-baseline drain) is queued for overnight via the existing codemod path. C (Caprica vision) stays deferred unless you want it tonight.

## Out of scope

- Any Phase 5/6 migrations (`canonical_facts`, `raw_records`, vector indexes) — wait for ADR acceptance to land first.
- Phase 7 connector contract — depends on Phase 6 source-adapter shape stabilising.
- Touching the any-baseline foreground.

## Verification

- ADR-0006: `scripts/check-doc-drift.ts` clean (CHANGELOG bullet covers it).
- CodeQL close: GitHub UI shows default CodeQL disabled + 0 open alerts; `discussion_actions` row flips to `done` with capability_event row.

## Size

ADR-0006 fill: ~1 file edit, ~1 CHANGELOG line, ~1 mem update.
CodeQL close: ~0 repo files (GitHub API call + DB update via migration or `awip-api`).

Pick D+A, or override with A/B/C only.
