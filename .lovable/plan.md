## 1. Flip `run_overnight = true` on three phases

Single migration sets `roadmap_phases.run_overnight = true` for:

- `phase-6` (Ingest & Canonicalisation)
- `phase-6b` (Ingest Observability)
- `phase-7` (Connector Marketplace)

`overnight-prequeue` (21:55 UTC) will auto-pick them up tonight. Each is independently reversible from `/master-plan` via the existing "Run overnight" toggle. `phase-5`, `phase-okr`, `phase-9`, `phase-11` stay operator-only because their contract surfaces need human design.

## 2. New Ollama job kind: `codemod_replace_any`

A file-scoped job that drafts a typed replacement for each `@typescript-eslint/no-explicit-any` site. Output never lands on `main` directly — it goes through the existing `ai_draft_outputs` review surface and is gated by lint-delta + CI before an operator merges.

### Contract (`supabase/functions/_shared/contracts/ai-jobs.ts`)

Add to `AI_JOB_KINDS`:

```text
"codemod_replace_any"
```

Input schema:

```text
CodemodReplaceAnyInput {
  file_path: string (≤300)
  ts_source: string (≤60000)        // current file contents
  any_sites: Array<{                 // pre-extracted by enqueuer
    line: number
    col: number
    snippet: string (≤400)           // ±3 lines around the `any`
    hint?: string (≤200)             // e.g. "param of useFoo callback"
  }> (1..40)
  surrounding_types?: string (≤8000) // optional: nearby type defs / imports
}
```

Prompt: system instructs Ollama to "replace every `any` with the narrowest sound type; if uncertain, emit `unknown` + a TODO comment; never change runtime behaviour; output a unified diff against `ts_source`". User payload is the file + sites.

Projector → `ai_draft_outputs` row with `target_ref = { file_path, any_sites_count }` and `body_md` = the diff fenced as `diff`.

### Enqueuer

New cron-triggered edge fn `codemod-any-enqueue` (nightly 22:10 UTC, gated by night window so it auto-picks the cheap model via `pickModel()`):

1. Run `eslint --rule '@typescript-eslint/no-explicit-any: error' -f json` against `src/` only (worker invokes via existing ESLint config).
2. Bucket findings by file, cap 40 sites per job, skip files already touched by an unmerged draft.
3. Enqueue one `ai_jobs` row per file with `Idempotency-Key = sha256(file_path + git_head)`.
4. Hard cap: 30 new jobs per night to keep review load human-sized.

### Review path

- `/admin/ai-usage` already lists `ai_draft_outputs`. We add a small "Codemod queue" filter chip.
- Merge action posts the diff to a new branch via existing GitHub PR helper (out of scope for this turn — drafts only).
- Discussion action #20 stays open until the queue drains.

## 3. CodeQL email noise — disable the GitHub default setup

The failing 45-minute job in the screenshot is **not** our workflow (`.github/workflows/codeql.yml`, timeout 20 min, currently green in ~2 min on every push). It's GitHub's **default CodeQL setup** running in parallel — the exact dual-setup conflict already documented at `docs/ci-cd.md § "CodeQL: default vs advanced setup"`.

Fix is one click in repo settings (no code change possible from here):

```text
Repo → Settings → Code security → Code scanning →
  "CodeQL analysis" row → Set up ▾ → Switch to advanced
  (or Disable, then rely on our workflow)
```

Once disabled, the red emails stop and only our advanced workflow reports findings under Security → Code scanning.

### Tracking

Open a `discussion_actions` row "Disable GitHub default CodeQL setup" tagged `ci-cd`, `risk=low`, `night_eligible=false` (operator-only repo settings change) so it shows up on the Morning Review until done.

## Files

- `supabase/migrations/<ts>_phase_run_overnight_6_6b_7.sql` — 3-row update + emits 3 `roadmap_phase_events`.
- `supabase/functions/_shared/contracts/ai-jobs.ts` — add `codemod_replace_any` kind, schema, prompt, projector.
- `supabase/functions/codemod-any-enqueue/index.ts` — new cron-triggered enqueuer (wrapped with `withLogger`).
- `supabase/config.toml` — schedule entry for `codemod-any-enqueue` at `10 22 * * *`.
- `src/components/admin/AiDraftsPanel.tsx` (or equivalent) — add "Codemod queue" filter chip.
- `supabase/migrations/<ts>_codeql_default_setup_action.sql` — insert `discussion_action` row for the manual repo-settings change.
- `CHANGELOG.md`, `docs/credits-usage.md` unchanged; `docs/ci-cd.md` already covers the CodeQL guidance.
- `mem://features/automation` — append the new job kind + cron.

## Out of scope

- Auto-merging codemod diffs to `main`.
- Wiring `codemod_replace_any` into the Night Agent audit loop (it runs through the existing draft-review surface instead).
- Anything in `phase-5`, `phase-okr`, `phase-9`, `phase-11`.
