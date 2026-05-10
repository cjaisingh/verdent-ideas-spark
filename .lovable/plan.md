
## Goal

Close the "nothing reviews the boring stuff" gap. Three deliverables, one PR each so they can be approved independently.

---

## 1. Quarterly Review System

A single source of truth for "what should be checked every 90 days," plus an automated reminder that opens an actionable item in the operator console — not just a calendar ping.

### What gets created

- **`docs/quarterly-review.md`** — the checklist itself. Sections:
  - Scaffold configs (vite/tsconfig/eslint/postcss/components.json) — diff against current Lovable starter template
  - Tailwind tokens vs. component usage drift
  - Major-version Dependabot PRs awaiting human review
  - Edge function inventory — caller check
  - Cron job inventory — "still useful?" pass
  - `mem://` accuracy sweep (light)
  - ADRs — "still true?" pass
  - Secrets rotation (`AWIP_SERVICE_TOKEN`, `GITHUB_REVIEWS_TOKEN`, Telegram tokens)
  - Sidebar / nav IA review (trigger if route count > 30)
  - RLS coverage report (`scripts/rls-coverage-report.ts`) summary

- **New edge function `quarterly-review-open`** — idempotent. On run, inserts one `discussion_action` titled `Quarterly review — Q{n} {YYYY}` linking to `docs/quarterly-review.md`, tagged `night_eligible=false` (this is human work), `owner=operator`, `due` = 14 days out. Skips if a row with the same Q{n}-{YYYY} key already exists.

- **Cron schedule** — Jan 1, Apr 1, Jul 1, Oct 1 at 09:00 UTC, via `pg_cron` + `AWIP_SERVICE_TOKEN` (matches existing pattern).

- **Memory** — add `mem://preferences/review-cadence` summarizing the cadence table from my previous answer so future sessions stop guessing.

### Out of scope

No automation that *performs* the review — just opens the action. Humans still drive the actual sweep.

---

## 2. Scaffold Config Refresh (one-shot)

Bring template files in line with the current Lovable starter (`vite_react_shadcn_ts_2026-04-20` is what we have; we'll diff against latest at implementation time).

### Files in scope

`vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `postcss.config.js`, `components.json`, `tailwind.config.ts` (the framework parts only — design tokens are untouched).

### Approach

1. Read each file, compare to a freshly-scaffolded Lovable project of the same template family.
2. For every divergence: keep the AWIP-specific change (path aliases, Tailwind tokens, plugin order) and adopt the upstream change for everything else.
3. Run `bun run build` + `bunx vitest run` + Playwright smoke (`e2e-playwright/roadmap.spec.ts`) to verify nothing regressed.
4. Update `CHANGELOG.md` under "Tooling".

### Risk

Low-medium. Worst case: a TS strictness flip surfaces existing type errors. We fix or revert per-file, not all-or-nothing.

### Out of scope

`package.json` dependency bumps — Dependabot owns that. We only touch config files.

---

## 3. Dead-Code / Edge-Function Sweep (one-shot)

Verify which of the ~30 edge functions in `supabase/functions/` still have callers.

### Method

For each function directory:

1. **Frontend callers** — `rg "functions.invoke\\(['\"]<name>" src/` and `rg "/functions/v1/<name>" src/`.
2. **Edge-to-edge callers** — same `rg` against `supabase/functions/`.
3. **Cron callers** — `select * from cron.job where command like '%<name>%'`.
4. **External callers** — check `docs/api.md`, `docs/rork-companion-spec.md`, `mem://features/*` for documented external use.

### Output

`docs/edge-function-sweep-2026-05-10.md` with a table:

```text
| function              | frontend | edge | cron | external | verdict        |
| --------------------- | -------- | ---- | ---- | -------- | -------------- |
| awip-api              | ✓        | -    | -    | ✓ (Rork) | keep           |
| copilot-noop-llm      | -        | -    | -    | -        | candidate kill |
| ...                                                                        |
```

Verdicts: **keep** / **candidate kill** / **needs operator decision**. No functions are deleted in this PR — kill list lands as a follow-up after operator review.

### Bonus

While we're in the listing, flag any function whose `index.ts` lacks `withLogger` (the `logger-validation.yml` check should catch these, but a manual pass confirms).

---

## Sequencing

```text
PR-1  Quarterly Review System   (~2h, low risk, immediate value)
PR-2  Edge-Function Sweep        (~1h, read-only, produces a kill list)
PR-3  Scaffold Config Refresh    (~2h, needs build+test verification)
```

Each PR is independent — approve and merge in any order.

## Verification caveat

Per `mem://preferences/verification-discipline`: the cron registration in PR-1 is verifiable from the Supabase side; the GitHub-side workflows are not (no confirmed git remote). PR-3's CI runs are similarly unverifiable from the sandbox — I'll run the build and tests locally inside the sandbox and report results, but cannot prove a green PR check on GitHub.

## Approve to start with PR-1, or pick a different order.
