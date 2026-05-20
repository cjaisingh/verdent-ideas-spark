## Goal

Stop the bleeding on `@typescript-eslint/no-explicit-any` without flipping CI red on day one. Today the rule is `warn` and there are **302 occurrences in `src/`** (eslint count, lower than the 458 grep figure that includes generic angle brackets in strings) tracked by open `discussion_action #20`. We need a ratchet: count can only go *down*, and any file currently at zero must stay at zero — promoted to a hard error per-file.

Two-lever approach, both deterministic, both cheap to maintain.

## What gets built

### 1. Baseline snapshot — `.lint-baselines/no-explicit-any.json`

Generated once by running `bun run lint --format json`, filtering on rule `@typescript-eslint/no-explicit-any`, grouping by `filePath` (relative). Shape:

```json
{
  "generatedAt": "2026-05-20T…Z",
  "rule": "@typescript-eslint/no-explicit-any",
  "total": 302,
  "files": {
    "src/components/foo/Bar.tsx": 7,
    "src/lib/x.ts": 2
  }
}
```

Checked in. This is the budget — it can only shrink.

### 2. Ratchet script — `scripts/lint-any-ratchet.ts`

Bun script. Runs eslint, parses JSON, compares against the baseline:

- **Fails (exit 1)** if `total` > baseline.total.
- **Fails** if any file's count > baseline.files[path] (i.e. regressed in place).
- **Fails** if a file appears that isn't in baseline AND has ≥1 occurrence (new code introducing `any`).
- **Passes + prints diff** if counts dropped — and tells the operator: "run `bun run lint:ratchet -- --write` to lower the baseline."
- `--write` flag: rewrites the JSON with current counts, refusing to *raise* any entry (defence in depth — `--write` shouldn't accidentally enshrine a regression).

Single file, no deps beyond `bun:` builtins. ~120 lines.

### 3. `eslint.config.js` — promote clean files to `error`

After loading `.lint-baselines/no-explicit-any.json` at config time, add a third config block:

```js
{
  files: ALL_TS_FILES_NOT_IN_BASELINE,   // computed from disk + baseline keys
  rules: { "@typescript-eslint/no-explicit-any": "error" }
}
```

So:
- Files already clean today cannot regress — `error` blocks the PR locally.
- Files in the baseline keep `warn` (legacy debt).
- As baseline shrinks via `--write`, more files automatically slide into the `error` bucket. Self-tightening.

The baseline file is `import`-able JSON so config stays one statement.

### 4. Package script + CI wire-up

`package.json`:
```json
"lint:ratchet": "bun scripts/lint-any-ratchet.ts"
```

`.github/workflows/lint-and-typecheck.yml` — add one step after `bun run lint`:
```yaml
- name: no-explicit-any ratchet
  run: bun run lint:ratchet
```

Same job, no new workflow. Branch-protection requirement on "Lint + Typecheck" already covers it.

### 5. Docs + memory

- `CHANGELOG.md` — Unreleased / Changed: ratchet wired, baseline 302, clean files now `error`.
- `mem/preferences/lint-policy.md` — currently *referenced* in `mem/index.md` but missing on disk. Create it with the new policy:
  - Rule stays `warn` globally for backward compat.
  - Ratchet enforces "never up, only down".
  - Files at zero are auto-promoted to `error` via baseline diff.
  - To intentionally lower the baseline after a cleanup: `bun run lint:ratchet -- --write`, commit the JSON.
- `docs/lint-policy.md` (new, one short page) — same content as the memory, but linked from `AGENTS.md` working agreements.
- Update `AGENTS.md` working agreements with a bullet: "Don't introduce new `any`. Ratchet fails the build."

## Technical notes

- Ratchet uses the same `eslint .` invocation the lint job already uses — no second compile/load cost beyond eslint itself.
- `tsx` codemod work for the existing 302 is **out of scope** here — that's `codemod-any-enqueue` + discussion_action #20.
- The baseline file is *human-readable* so reviews can sanity-check ratchet movements in the diff.
- No new tables, no edge functions, no migration. Pure repo-config change.

## Definition of done

- `.lint-baselines/no-explicit-any.json` committed with current 302 budget.
- `bun run lint:ratchet` passes on `main`, exits non-zero when I add a `: any` to a previously-clean file (verified by a throwaway local diff).
- New step green in `lint-and-typecheck.yml`.
- `eslint.config.js` error-promotes files not in baseline.
- `CHANGELOG.md`, `docs/lint-policy.md`, `mem/preferences/lint-policy.md`, `AGENTS.md` updated.
- `discussion_action #20` gets a note: "Ratchet shipped; cleanup work now reduces baseline numbers — every PR that lowers a count should re-run `lint:ratchet --write`."

## Out of scope

- Actually deleting any of the 302. Cleanup belongs to `codemod-any-enqueue` + the existing discussion action.
- Tightening any other ESLint rule (`no-unused-expressions`, `prefer-const`, etc.). Same pattern would apply but is a separate decision.
- Flipping the global rule to `error`. Not yet — that lands when the baseline hits 0.
- Edge-function `supabase/functions/*` — already excluded from the lint workflow scope; same exclusion stays. (If we want them too, separate plan.)
