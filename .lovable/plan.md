## Goal

Reduce overnight AI cost by switching scheduled jobs from `openai/gpt-5` to the cheapest viable Gemini tier.

## Audit of AI usage in scheduled / overnight code paths

| Job | Cadence | Current model | Notes |
|---|---|---|---|
| `daily-plan` | Nightly 05:30 UTC | `openai/gpt-5` | Summarises open work into a daily plan + JSON risks/recommendations. Two calls per run. |
| `scheduled-code-review` | Weekly Mon 06:00 UTC | `openai/gpt-5` | Reviews 7 days of git diff. Long context, structured findings. |
| `discussion-extract-actions` | On-demand (operator) | `google/gemini-2.5-flash` | Already cheap. Not nightly. Leave as-is. |
| `night-agent` (`open`/`close`) | 22:00–06:00 UTC | No direct LLM calls | Pulls QA + test results only. No change needed. |
| `finding-discuss-copilot`, `route-operator-message` | Operator-triggered | gemini-2.5-pro / gpt-5-mini / gemini-3-flash | Not part of nightly batch. Leave as-is. |

## Changes

1. **`supabase/functions/daily-plan/index.ts`**
   - `PLANNER_MODEL`: `openai/gpt-5` → `google/gemini-2.5-flash-lite`
   - Rationale: nightly summarisation/classification — exactly the workload `flash-lite` is best at.

2. **`supabase/functions/scheduled-code-review/index.ts`**
   - `REVIEWER_MODEL`: `openai/gpt-5` → `google/gemini-2.5-flash`
   - Rationale: code review needs more nuance than `flash-lite` can offer reliably, but `2.5-flash` is dramatically cheaper than `gpt-5` and still strong for diff review. Persisted in `roadmap_review_findings.reviewer_model` so future runs are auditable.

3. **`docs/automation.md`**
   - Update the model names mentioned in the "AI code review" and "Daily plan" sections so docs match reality.

## Out of scope

- Operator-triggered (interactive) AI calls — left on their current models since they're not part of the overnight cost.
- Night-agent step pipeline — uses no LLM.
- No schema changes; `reviewer_model` already records which model produced each finding, so the swap is auto-traceable.
