---
name: Lint policy
description: ESLint rule status and tech-debt gating for the verdent-ideas-spark mirror
type: preference
---
`@typescript-eslint/no-explicit-any` is intentionally set to `warn` (not `error`) in `eslint.config.js`. Reason: ~480 pre-existing `any` usages would otherwise red the Lint & Typecheck / CI / Deploy Production workflows on the verdent-ideas-spark mirror.

**How to apply:** Do not promote this rule back to `error` until the open `discussion_action` "Replace ~480 @typescript-eslint/no-explicit-any usages" reports the count is below ~50. The `lint` script is plain `eslint .` (no `--max-warnings 0`), so warnings are non-blocking by design.

When adding new code, still avoid `any` — prefer `unknown` + narrowing. The warn-level rule will surface new offenders in the lint output.
