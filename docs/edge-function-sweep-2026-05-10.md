# Edge-Function Sweep — 2026-05-10

Read-only audit of every function under `supabase/functions/` (excluding `_shared`). For each, we counted:

- **frontend** — files in `src/` calling it via `functions.invoke('<name>')` or `/functions/v1/<name>`
- **edge** — other edge functions calling it
- **cron** — known cron registrations (from `mem://index.md` Core + new additions)
- **docs** — files in `docs/` or `mem/` mentioning the name
- **logger** — whether `index.ts` wraps with `withLogger` from `_shared/logger.ts`

## Verdict table

| function | fe | edge | cron | docs | logger | verdict | notes |
|---|---|---|---|---|---|---|---|
| `awip-api` | 10 | 2 | – | 16 | ✓ | **keep** | Core contract surface + Rork client |
| `awip-rag` | 1 | 0 | – | 5 | ✓ | **keep** | RAG search backend |
| `awip-reviews-pull` | 0 | 0 | ✓ weekly Mon | 2 | ✓ | **keep** | cron-only |
| `app-walkthrough` | 2 | 0 | ✓ nightly 02:15 | 2 | ✓ | **keep** | |
| `automation-auth-monitor` | 0 | 0 | – | 1 | ✓ | **needs operator decision** | No callers found; verify if cron-registered or planned |
| `companion-cloud-chat` | 1 | 0 | – | 3 | ✗ | **keep + fix** | Missing `withLogger` — add wrapper |
| `companion-context` | 1 | 0 | – | 1 | ✗ | **keep + fix** | Missing `withLogger` |
| `companion-extract-actions` | 1 | 0 | – | 3 | ✓ | **keep** | |
| `copilot-noop-llm` | 0 | 1 | – | 2 | ✓ | **keep** | Test/safety target |
| `copilot-voice` | 0 | 0 | – | 2 | ✓ | **needs operator decision** | No live callers; was Deepgram-driven voice — possibly superseded by `gemini-tts` |
| `daily-plan` | 1 | 0 | – | 3 | ✓ | **keep** | |
| `db-explorer` | 1 | 0 | – | 3 | ✓ | **keep** | |
| `deep-audit` | 1 | 0 | ✓ weekly + monthly | 5 | ✓ | **keep** | |
| `deepgram-realtime-token` | 3 | 0 | – | 2 | ✓ | **keep** | |
| `discussion-extract-actions` | 1 | 0 | – | 3 | ✓ | **keep** | |
| `finding-discuss-copilot` | 1 | 0 | – | 1 | ✓ | **keep** | |
| `frontend-errors` | 1 | 0 | – | 1 | ✓ | **keep** | |
| `gemini-tts` | 1 | 0 | – | 6 | ✗ | **keep + fix** | Default voice; missing `withLogger` |
| `lessons-synthesize` | 1 | 0 | ✓ weekly | 3 | ✓ | **keep** | |
| `morning-review` | 1 | 0 | ✓ daily 06:00 | 9 | ✓ | **keep** | |
| `night-agent` | 1 | 0 | ✓ open/close | 4 | ✓ | **keep** | |
| `overnight-phase-runner` | 1 | 0 | ✓ every 15m | 2 | ✓ | **keep** | |
| `overnight-prequeue` | 0 | 0 | ✓ daily 21:55 | 1 | ✓ | **keep** | cron-only |
| `qa-validate` | 1 | 1 | ✓ | 2 | ✓ | **keep** | |
| `quarterly-review-open` | 0 | 0 | ✓ Jan/Apr/Jul/Oct 1 | 2 | ✓ | **keep** | new (this PR) |
| `record-test-run` | 0 | 0 | ✓ nightly | 4 | ✓ | **keep** | called by `nightly.yml` GitHub Action |
| `retention-sweep` | 0 | 0 | ✓ | 2 | ✓ | **keep** | cron-only |
| `roadmap-log-work` | 0 | 2 | – | 1 | ✓ | **keep** | edge-to-edge only |
| `roadmap-phase-signoff` | 0 | 0 | – | 2 | ✓ | **needs operator decision** | Doc'd but no callers; verify if reachable from `/roadmap` UI under a different name |
| `route-operator-message` | 0 | 1 | – | 2 | ✓ | **keep** | |
| `scheduled-code-review` | 1 | 0 | ✓ | 3 | ✓ | **keep** | |
| `secrets-health-check` | 1 | 0 | – | 1 | ✓ | **keep** | |
| `sentinel-tick` | 1 | 0 | ✓ every 15m | 5 | ✓ | **keep** | |
| `telegram-bot-info` | 2 | 0 | – | 1 | ✓ | **keep** | |
| `telegram-send` | 0 | 3 | – | 2 | ✓ | **keep** | edge-to-edge only |
| `telegram-send-voice` | 0 | 1 | – | 2 | ✓ | **keep** | |
| `telegram-test` | 1 | 0 | – | 1 | ✓ | **keep** | |
| `telegram-webhook` | 0 | 0 | – | 1 | ✓ | **keep** | external (Telegram callback) |

## Summary

- **38 functions total** (37 pre-existing + `quarterly-review-open` added in this PR).
- **34 keep** — at least one verifiable caller path.
- **3 need operator decision** — no callers found from the sandbox, may be reachable via paths the script didn't check:
  - `automation-auth-monitor`
  - `copilot-voice`
  - `roadmap-phase-signoff`
- **3 missing `withLogger` wrapper** — should be added in a follow-up:
  - `companion-cloud-chat`
  - `companion-context`
  - `gemini-tts`

## Caveats

- "cron" column reflects the registrations enumerated in `mem://index.md` Core + the one added in this PR. Direct read of `cron.job` failed with a permission error from the sandbox `psql` session, so cron mappings for functions outside that list are unverified.
- "external" callers (GitHub Actions, Rork iPhone app, Telegram webhook) are inferred from docs, not measured.
- No functions are deleted in this PR — the kill list lands as a follow-up after the operator confirms the three "needs operator decision" entries.

## Recommended follow-up

1. Operator confirms or kills `automation-auth-monitor`, `copilot-voice`, `roadmap-phase-signoff`.
2. Wrap the three logger-missing functions; the `logger-validation.yml` CI gate should already be flagging these.
3. Re-run this sweep at the next quarterly review (per `docs/quarterly-review.md` § 4).
