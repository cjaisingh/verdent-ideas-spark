# Edge function audit — 2026-05-10

35 edge functions live under `supabase/functions/` (plus `_shared/`). This audit maps each to how it's invoked and flags scaffolding for operator review.

## Legend

- **Cron** — invoked by a `pg_cron` job (see `cron.job` table)
- **UI** — invoked from `src/` via `supabase.functions.invoke()` or direct fetch to `/functions/v1/<fn>`
- **Server** — invoked by another edge function or by an external service (Telegram, GitHub Actions, postgres `net.http_post` triggers)
- **Orphan** — no caller found in the repo

## Inventory

| Function | Cron | UI | Server | Notes / Recommendation |
|---|:-:|:-:|:-:|---|
| `awip-api` | | ✓ | ✓ (telegram-webhook, copilot-voice) | Core contract surface. Keep. |
| `awip-rag` | | ✓ Companion + Copilot | | Now documented in `docs/awip-rag.md`. Keep. |
| `automation-auth-monitor` | ✓ `*/5 * * * *` | | | Keep. |
| `companion-cloud-chat` | | ✓ Companion | | Keep. |
| `companion-context` | | ✓ companion-live-state | | Keep. |
| `companion-extract-actions` | | ✓ Companion | | Keep. |
| `copilot-noop-llm` | | | ✓ copilot-voice (single fallback) | **Review.** Single caller; confirm whether the no-op path is still meaningful or whether `copilot-voice` can fall through silently. |
| `copilot-voice` | | ✓ (browser worklet) | | Keep. |
| `daily-plan` | ✓ `30 5 * * *` | ✓ DailyPlanCard | | Keep. |
| `db-explorer` | | ✓ DbExplorer page | | Keep. |
| `deep-audit` | ✓ weekly + monthly | ✓ Audits page | | Keep. |
| `deepgram-realtime-token` | | ✓ AppSecretsPanel + voice surfaces | | Keep. |
| `discussion-extract-actions` | | ✓ DiscussionActionsPanel | | Keep. |
| `finding-discuss-copilot` | | ✓ CopilotDiscussionSheet | | Keep. |
| `frontend-errors` | | ✓ frontend-error-capture | | Keep. |
| `gemini-tts` | | ✓ GeminiTtsTestPanel | ✓ Rork iPhone app | Keep. |
| `lessons-synthesize` | ✓ weekly | ✓ LessonsLoop page | | Keep. |
| `morning-review` | ✓ daily 06:00 | ✓ MorningReview page | | Keep. |
| `night-agent` | ✓ open 22:00 / close 06:00 | ✓ NightAgentScheduleCard, NightBacklogTable | ✓ self (open → qa-validate) | Keep. |
| `overnight-phase-runner` | ✓ `*/15 * * * *` | ✓ OvernightBackfillPanel | | Keep. |
| `overnight-prequeue` | ✓ `55 21 * * *` | | | Keep. |
| `qa-validate` | ✓ | ✓ AutomationPanel | ✓ night-agent/open | Keep. |
| `record-test-run` | | | ✓ `.github/workflows/nightly.yml` | Keep — POST endpoint for CI. |
| `retention-sweep` | ✓ `30 3 * * *` | | | Keep. |
| `roadmap-log-work` | | | ✓ telegram-webhook, route-operator-message | Keep. |
| `roadmap-phase-signoff` | | | ✓ approval queue webhook (postgres trigger) | Keep — verified via approval flow integration tests. |
| `route-operator-message` | | | ✓ telegram-webhook | Keep. |
| `scheduled-code-review` | ✓ | ✓ AutomationPanel | | Keep. |
| `secrets-health-check` | | ✓ CronSecretsCheckPanel | | Keep. |
| `sentinel-tick` | ✓ `*/15 * * * *` | ✓ SentinelStatusStrip | | Keep. |
| `telegram-bot-info` | | ✓ TelegramBotPanel, ControlPlane | | Keep. |
| `telegram-send` | | | ✓ telegram-webhook, telegram-send-voice, route-operator-message | Keep. |
| `telegram-send-voice` | | | ✓ route-operator-message (single caller) | **Review.** Only used for one optional voice-reply path. If voice replies aren't part of the operator workflow today, candidate to remove. |
| `telegram-test` | | ✓ TelegramBotPanel ("Send test") | | Keep — operator diagnostic, low cost. |
| `telegram-webhook` | | | ✓ Telegram (external HTTPS) | Keep. |

## Flagged candidates

Two functions worth a 5-minute operator decision before deletion:

1. **`copilot-noop-llm`** — appears to be a placeholder/no-op LLM endpoint kept around so `copilot-voice` has *something* to call when no model is configured. If we always have a real model wired today, this can go.
   - **Verify:** read `supabase/functions/copilot-voice/index.ts` line 798 context → if the call is gated behind a feature flag that's off, delete both the flag and this function.
2. **`telegram-send-voice`** — sends a voice note via Telegram. Single caller (`route-operator-message`). If you don't use voice replies on Telegram, it's dead weight.
   - **Verify:** check `route-operator-message` for the conditional that triggers it; ask whether any operator has used voice-out in the last 30 days.

**No deletions executed in this audit.** When you decide on each, I'll run `supabase--delete_edge_functions` + remove the folders + update README/CHANGELOG.

## Re-running this audit

```bash
# Cron mappings
psql -c "select jobname, schedule from cron.job order by jobname"

# UI invocations
rg -no "functions\.invoke\(['\"]([a-z0-9_-]+)" src/ -r '\$1' | sort -u
rg -no "/functions/v1/([a-z0-9_-]+)" src/ -r '\$1' | sort -u

# Server-to-server
rg -no "functions/v1/([a-z0-9_-]+)" supabase/functions/ -r '\$1' | sort -u
```
