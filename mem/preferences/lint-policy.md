---
name: Lint policy
description: no-explicit-any is warn globally but ratcheted via baseline; clean files auto-promoted to error
type: preference
---
`@typescript-eslint/no-explicit-any` stays `warn` so legacy files don't break local dev, but `.lint-baselines/no-explicit-any.json` freezes the per-file count and `scripts/lint-any-ratchet.ts` (CI step in `lint-and-typecheck.yml`) fails the build if any file regresses, any new file introduces `any`, or total goes up. `eslint.config.js` promotes every file **not** in the baseline to `error` — once-clean files stay clean. Lower the baseline with `bun run lint:ratchet -- --write` (lower-only; refuses to raise). Cleanup tracked by discussion_action #20; `codemod-any-enqueue` drafts narrow-type diffs. When baseline hits 0 → delete the JSON and flip the global rule to `error`. See `docs/lint-policy.md`.
