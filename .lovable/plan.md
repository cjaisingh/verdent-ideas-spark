## Goal

Wire the Phase 5/6/6b retrieval contracts into `supabase/functions/overnight-phase-runner/index.ts` so each queued `roadmap_phase_overnight_runs` row consumes the typed contract end-to-end — without faking Phase 5/6 ingest (the underlying `tenant_nodes` / `canonical_facts` / `fact_conflicts` tables don't exist yet).

The honest integration is: **the runner stamps the contract identity into the prompt, validates the AI's structured response against a Zod envelope, and refuses to mark the run `done` if the contract isn't acknowledged.** Types flow from `_shared/contracts/*.ts` → mapping → runner prompt → AI response → Zod parse → run row + `ai_usage_log.request_ref`.

## Why this shape

The contracts already exist as types + Zod schemas. The runner today produces unstructured `{summary, risks, recommendations}` with no link back to the governing contract or ADR. That's the gap. Adding a phase→contract mapping and a typed response envelope makes the contract identity load-bearing instead of decorative — break the type, break the build; ignore the contract, fail the run.

## Deliverables

### 1. `supabase/functions/_shared/contracts/phase-contract-map.ts` (new, ~80 lines)

- `import` all four `RETRIEVAL_*_CONTRACT` consts + `RetrievalContractMeta`.
- `export type PhaseKey = "phase-5" | "phase-6" | "phase-6b" | "phase-7";`
- `export type PhaseContractBinding = { phaseKey: PhaseKey; contract: RetrievalContractMeta; adrs: readonly string[]; guardrails: readonly string[]; };`
- `export const PHASE_CONTRACTS: Record<PhaseKey, PhaseContractBinding>` populated from the docs we already wrote (`docs/phases-overnight-operator-guide.md` "Won't do" lines map to `guardrails`; "Governed by" lines map to `adrs`).
- `export function getPhaseBinding(phaseKey: string): PhaseContractBinding | null` — returns `null` for any key not in the map; runner treats that as "no contract — proceed as today" so unrelated phases (phase-1..4) aren't broken.

### 2. `supabase/functions/_shared/contracts/overnight-envelope.ts` (new, ~40 lines)

- `OvernightResponseEnvelopeSchema` (Zod):
  - `contract_acknowledged: z.string().min(1)` — must match `binding.contract.declaredBy` or `binding.contract.store` exactly (cross-checked in runner, not in schema).
  - `guardrails_respected: z.array(z.string()).min(1)` — must be a non-empty subset of `binding.guardrails`.
  - `would_violate: z.array(z.string())` — anything the AI considered but rejected.
  - `summary: z.string().min(1).max(4000)`.
  - `risks: z.array(z.string().min(1)).max(10)`.
  - `recommendations: z.array(z.string().min(1)).max(10)`.
- `export type OvernightResponseEnvelope = z.infer<typeof ...>`.

### 3. `supabase/functions/overnight-phase-runner/index.ts` (modify in place)

Surgical edits:

- Import `getPhaseBinding` + `OvernightResponseEnvelopeSchema`.
- After fetching `run`, call `getPhaseBinding(run.phase_key)`. If non-null:
  - Inject contract identity into the system prompt: shape, store, token budget, fallback rule, ADR list, the literal `guardrails` array, and explicit instruction "your JSON must include `contract_acknowledged`, `guardrails_respected`, `would_violate` fields".
  - Truncate user payload to `binding.contract.tokenBudget * 4` chars (rough token→char proxy) instead of the current hard 40 000.
- After `JSON.parse(aiJson.content)`:
  - If binding exists, run `OvernightResponseEnvelopeSchema.safeParse(parsed)`. On failure or if `contract_acknowledged` doesn't match `binding.contract.declaredBy`/`store` or any `guardrails_respected` entry is not in `binding.guardrails` → set run `status='auto_blocked'`, `last_error='contract envelope rejected: <reason>'`, do **not** charge attempts back to queue (this is a hard block), and `dispatchAlert`.
  - On success, store the envelope + `phase_binding: { phaseKey, contractStore: binding.contract.store, adrs: binding.adrs }` on the run row's `result`.
- Add `phase_binding` to `ai_usage_log.request_ref` so per-phase contract spend is queryable later.
- No change for runs with `phase_key` not in the map — backward-compat path stays identical.

### 4. Tests — extend `supabase/functions/_shared/contracts/retrieval_contracts_test.ts`

New `Deno.test` cases (4 added, ~50 lines):

- **mapping completeness**: every entry in `PHASE_CONTRACTS` points to a real `RETRIEVAL_*_CONTRACT` const (identity, not deep equal).
- **mapping coverage**: keys are exactly `["phase-5","phase-6","phase-6b","phase-7"]`.
- **envelope rejects unknown guardrail**: a `guardrails_respected` entry not in `binding.guardrails` → cross-check helper returns false.
- **envelope rejects bad shape**: missing `contract_acknowledged` → `safeParse(...).success === false`.

Run via `supabase--test_edge_functions` — must stay all-green.

### 5. Docs + memory

- `docs/phases-overnight-operator-guide.md` — append a "How the runner enforces this" subsection per phase pointing to `phase-contract-map.ts` and the envelope.
- `CHANGELOG.md` — one `### Changed` bullet under `[Unreleased]`.
- `mem/features/phase-5-6-prep.md` — add a "Runner integration" line under "Overnight runner expectations".
- No new memory file — extending the existing one is enough.

## Out of scope

- No new database tables (Phase 5/6 tables don't exist yet).
- No new edge functions, no cron changes, no UI.
- No change to `night-agent`, `overnight-prequeue`, or `overnight-recommender`.
- No fake retrieval execution against non-existent tables — the contract types flow end-to-end through prompt + response validation, not through a stub query.
- No change to retry semantics for non-contract errors (`max_retries` path stays as-is).
- No model change — still `gemini-2.5-flash-lite`.

## Verification

1. `supabase--test_edge_functions` — all retrieval contract tests + 4 new ones pass.
2. `bun run lint:ratchet` + typecheck clean (no new `any`).
3. Re-deploy `overnight-phase-runner` via `supabase--deploy_edge_functions`.
4. `supabase--curl_edge_functions` POST with `{run_id: "<a-real-queued-row>"}` against a Phase 5 run if one exists — confirm `result.phase_binding.contractStore === "tenant_nodes + tenant_node_aliases..."`. If no queued row, skip; the test suite is the load-bearing check.
5. `scripts/check-logger-coverage.ts` unaffected (`withLogger` already wrapping).

## Size

- 2 new shared files (~120 lines total).
- 1 modified edge function (~30 lines net added; surgical, not a rewrite).
- 1 extended test file (~50 lines).
- 3 doc/memory bullets.

~7 files touched. Runtime behaviour changes for runs whose `phase_key` is in `{phase-5, phase-6, phase-6b, phase-7}`; identical for everything else.
