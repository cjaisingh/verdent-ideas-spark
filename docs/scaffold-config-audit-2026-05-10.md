# Scaffold-Config Audit — 2026-05-10

Read-only audit of the framework config files for staleness vs. current Lovable starter (`vite_react_shadcn_ts_2026-04-20`).

## Files reviewed

- `vite.config.ts`
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `eslint.config.js`
- `postcss.config.js`
- `components.json`
- `tailwind.config.ts` (framework parts)

## Findings

**No actionable drift** found from a static read. Each file matches the patterns expected for the starter template version:

- `vite.config.ts` — uses `@vitejs/plugin-react-swc`, port 8080, `lovable-tagger` dev plugin, `@/` alias, dedupe list for React + react-query. All current.
- `tsconfig.app.json` — bundler resolution, ES2020 target, `react-jsx`, strict off. Standard Lovable defaults.
- `tsconfig.json` — solution-style references to app + node configs. Standard.
- `eslint.config.js` — flat config with `tseslint.config()`, react-hooks + react-refresh, ignoring `dist`. Standard.
- `postcss.config.js` — Tailwind + Autoprefixer. Trivial, no drift possible.

## Why no edits

Per `mem://preferences/verification-discipline`: I cannot prove from the sandbox what the **latest** Lovable template ships today. Modifying configs against an assumed-newer baseline risks breaking the build with no diff source to validate against.

The recommended path is to defer this to **operator confirmation at the next quarterly review** (per `docs/quarterly-review.md` § 1), where the operator can:

1. Spin up a throwaway Lovable project to capture the current starter.
2. Diff against the files above.
3. Cherry-pick legitimate upstream improvements.

## Things to watch for at next review

- `eslint.config.js` is the most likely to drift — `typescript-eslint` and `eslint-plugin-react-hooks` ship breaking config-shape changes routinely.
- `vite.config.ts` may grow new `optimizeDeps` or `build.target` entries.
- `tsconfig.app.json` `target` is `ES2020` — newer templates may have moved to `ES2022`.

## Verdict

**No-op for now.** Re-evaluate Q3 2026.
