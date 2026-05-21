## Goal

Lock the four Phase 5/6 retrieval contracts (`retrieval-ingest-concierge`, `retrieval-validation-agent`, `retrieval-resolver`, `retrieval-conflict-triage`) so the overnight runner cannot drift the shape. Two layers:

1. **Compile-time** — the contract `const` literal must have every required key with the right `shape` value, and the `Input` type must stay derivable from a single source of truth.
2. **Lightweight runtime** — valid samples parse; invalid samples (wrong shape, bad enum, missing required field, over-budget sampleSize) get rejected with a clear error.

Pattern follows `ai-jobs.ts` — Zod schemas live alongside the types in the same contract file, types derived via `z.infer`. Identical to how `ai-jobs.ts` already does it.

## Deliverables

### 1. Add Zod input schemas to each contract file (4 edits)

Each `retrieval-*.ts` file gets:

- `import { z } from "https://esm.sh/zod@3.23.8";` (same version as `ai-jobs.ts`)
- An `<Name>InputSchema` (Zod) capturing the existing `Input` type's invariants, including the documented refusal rules:
  - `retrieval-ingest-concierge`: `sourceRef` requires at least one of `rawRecordId` / `url`; `query` non-empty; `siblingFanout` integer 0–10.
  - `retrieval-validation-agent`: `sampleSize` ≤ 200 (matches the documented "refuse > 200" fallback); `columns` non-empty strings.
  - `retrieval-resolver`: `tenantId` uuid; `descriptors` non-empty; each descriptor `value` non-empty; `topK` 1–50.
  - `retrieval-conflict-triage`: `conflictId` uuid; `siblingWindowDays` 1–365.
- The existing `export type <Name>Input` is rewritten as `z.infer<typeof <Name>InputSchema>` so the type and the schema cannot drift.
- Output types untouched (runtime validation on outputs is the implementer's job per sprint, not this round).
- The contract `const` is widened with a `RetrievalContractMeta` type-assert via `satisfies` so missing/typoed keys fail typecheck.

### 2. New shared type — `_shared/contracts/retrieval-contract.ts`

Tiny module exporting:

```ts
export type RetrievalShape =
  | "prose" | "hierarchical-doc" | "tabular" | "graph" | "relational" | "time-series";

export type RetrievalContractMeta = {
  shape: RetrievalShape;
  store: string;
  primaryKey: string;
  tokenBudget: number;
  freshnessWindow: string;
  fallback: string;
  declaredBy: string;
};
```

Each contract const closes with `} as const satisfies RetrievalContractMeta;`. Compile-time guarantee that every contract carries every required key with the right enum value.

### 3. One Deno test file — `supabase/functions/_shared/contracts/retrieval_contracts_test.ts`

Single file, ~150 lines. Imports the four contracts + their schemas. Tests:

- **Per contract — contract literal sanity** (4 cases): `tokenBudget > 0`, `shape` is one of the allowed enums, `declaredBy` and `fallback` non-empty.
- **Per contract — valid input round-trips** (4 cases): a minimal valid sample parses cleanly.
- **Per contract — invalid input rejected** (4 cases, grouped):
  - ingest-concierge: empty `sourceRef` (neither rawRecordId nor url) → error.
  - validation-agent: `sampleSize: 1000` → error mentioning the 200 cap.
  - resolver: `tenantId: "not-a-uuid"` and empty `descriptors` → error.
  - conflict-triage: `siblingWindowDays: 9999` → error.
- **Type-derivation guard** (1 case): `expectType<<Name>Input, z.infer<typeof <Name>InputSchema>>()` helper so a future drift in either direction breaks the test build.

Uses the same imports as `alerts_dispatch_log_test.ts`:
```
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
```

Runs via the `supabase--test_edge_functions` tool — no other harness.

## Verification

- `supabase--test_edge_functions` with `functions: []` (or scoped to `_shared` if the runner supports it) — all 13 new test cases pass.
- `bun run lint` clean on the four edited contracts + two new files.
- `scripts/check-doc-drift.ts` unaffected (no new doc surface; CHANGELOG bullet covers it).
- `scripts/check-logger-coverage.ts` unaffected (no new edge function).

## Out of scope

- No runtime validation on the `Output` types — those land per implementer sprint.
- No changes to `night-agent.ts`, `source-adapter.ts`, `ai-jobs.ts`, `postmortem-generate.ts`, `credit-snapshot.ts`.
- No new edge function, no migration, no cron, no UI.
- ADR-0006 already accepted last turn — not touched.

## Size

- 4 contract files edited (~20 lines each).
- 1 new shared type file (~25 lines).
- 1 new Deno test file (~150 lines).
- 1 CHANGELOG bullet under `[Unreleased] › Added`.
- 1 mem update to `mem://features/phase-5-6-prep` noting the lockdown.

~7 files touched, no runtime behaviour change.
