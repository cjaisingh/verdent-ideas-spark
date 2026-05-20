# Lint policy

## `@typescript-eslint/no-explicit-any`

We carry legacy `any` debt (~500 sites). Rather than gate CI on a full cleanup, we ratchet:

- Global rule is `warn` so legacy files don't break local dev.
- `.lint-baselines/no-explicit-any.json` records the *exact* per-file count today. Treated as a budget — it can only shrink.
- Every file **not** in the baseline is promoted to `error` via an override block in `eslint.config.js`. Once a file is clean, it stays clean.
- `scripts/lint-any-ratchet.ts` runs `eslint --format json`, compares to the baseline, and fails CI if:
  - any file regresses (`now > was`), or
  - a file appears that isn't in the baseline and has ≥1 occurrence, or
  - the overall total exceeds baseline.total.
- Wired into `.github/workflows/lint-and-typecheck.yml` as the `no-explicit-any ratchet` step.

## Workflow

- **Adding new code**: just don't introduce `any`. The error-promotion will block it. Use `unknown` + narrowing, generics, or proper interfaces.
- **Cleaning up existing `any`** (counts go down): run `bun run lint:ratchet -- --write` and commit the updated baseline. The script is lower-only — it refuses to raise any entry.
- **Touching a baseline file**: you can edit freely as long as the count doesn't go up. Reducing it is encouraged; if you take it to zero, the override will start treating it as `error` automatically on the next baseline write.

## Why not flip the rule globally?

302 src warnings (517 repo-wide) is too much to fix in one PR. The ratchet gives us monotonic progress without a flag day. When the baseline hits zero we delete `.lint-baselines/no-explicit-any.json` and switch the global rule to `error` in `eslint.config.js`.

## Tracking

- Discussion action #20 owns the cleanup. Each PR that lowers the baseline should mention it in the description.
- The codemod pipeline (`codemod-any-enqueue`) drafts narrow-type diffs into `ai_draft_outputs` for operator review.
