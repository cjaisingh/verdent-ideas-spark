# Edge-Function Zombie Triage — 2026-05-24

Follow-up to [`edge-function-sweep-2026-05-10.md`](./edge-function-sweep-2026-05-10.md). Three functions had **no caller paths verifiable from the sandbox**. Each row needs an operator decision before the kill PR lands.

Tick one box per row, add initials + date, then a follow-up PR can delete (or document the live caller).

| Function | Likely status | Evidence | Decision | Operator |
|---|---|---|---|---|
| `automation-auth-monitor` | candidate-delete | No `functions.invoke('automation-auth-monitor')` in `src/`; no caller in `supabase/functions/`; not in cron list in `mem://index.md` Core; 1 doc mention only | `[ ]` keep · `[ ]` delete · `[ ]` needs-info | _____ / _____ |
| `copilot-voice` | candidate-delete | No live callers; 2 doc mentions only; superseded by `gemini-tts` (default voice path) and `deepgram-realtime-token` (mic capture) | `[ ]` keep · `[ ]` delete · `[ ]` needs-info | _____ / _____ |
| `roadmap-phase-signoff` | needs-info | 2 doc mentions, no `functions.invoke` match; possibly reachable via `/roadmap` UI under a different binding | `[ ]` keep · `[ ]` delete · `[ ]` needs-info | _____ / _____ |

## How to verify before ticking `delete`

1. Search the **mirror repo** (`cjaisingh/verdent-ideas-spark`) for `<name>` — Lovable-side `rg` only covers this sandbox.
2. Check the **Rork iPhone app** (separate Expo project) — `copilot-voice` predates `gemini-tts` and could still be referenced there. See `docs/rork-companion-spec.md`.
3. Check `pg_cron.job` directly (sandbox `psql` can't read it; operator can from the Cloud panel).
4. If still no caller after (1)–(3): tick `delete`.

## What happens after ticking

- `keep` → add a one-line `// callers: <path>` comment at the top of `index.ts` so the next sweep doesn't flag it again.
- `delete` → follow-up PR removes `supabase/functions/<name>/`, drops any matching cron row, and adds a CHANGELOG line.
- `needs-info` → open a `discussion_action` (source `plan_footer`) with the unanswered question.

## Cross-refs

- [`docs/edge-function-sweep-2026-05-10.md`](./edge-function-sweep-2026-05-10.md) — original sweep
- [`docs/edge-function-audit.md`](./edge-function-audit.md) — methodology
- [`docs/quarterly-review.md`](./quarterly-review.md) § 4 — re-sweep cadence
