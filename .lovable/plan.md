## Plan: Credit-efficiency pass

### What I checked first
- 7-day AI Gateway spend across all jobs: **$0.032 total** (11 + 1 + 2 + 1 + 3 calls). The expensive-looking routes (`google/gemini-2.5-pro` in `awip-api:analyze-transcript`, `finding-discuss-copilot`) haven’t fired in the last week.
- Night model policy is already in place (`pickModel` → `gemini-2.5-flash-lite` 22:00–06:00 UTC) and most non-realtime jobs route through it.
- `daily-plan` and `lessons-synthesize` are correctly on flash-lite.
- `route-operator-message:reply` is on `gpt-5-mini` and is not gated by `pickModel`.
- `awip-api:analyze-transcript` and `finding-discuss-copilot` are hardcoded to `gemini-2.5-pro` with no night fallback.

**Conclusion:** AI Gateway spend is not a real cost lever right now — it’s sub-cent per day. The credits you’re burning are **Lovable editor credits**, driven by my behavior, not by the app’s model routing.

So the pass splits into two parts.

### Part A — Tiny model-routing tightening (low impact, but cheap to do)
1. Wrap the three remaining hardcoded routes through `pickModel` so they auto-cheapen at night without changing daytime behavior:
   - `route-operator-message:reply` — `pickModel("openai/gpt-5-mini")`.
   - `awip-api:analyze-transcript` — `pickModel("google/gemini-2.5-pro")`.
   - `finding-discuss-copilot` — `pickModel("google/gemini-2.5-pro")`.
2. Add a one-line note in `mem://features/night-cheap-models` listing the three routes now covered.
3. No new tables, no UI, no cron changes. ~10-line diff per function.

This is bookkeeping rather than savings — at current volume it’s a couple of cents a month — but it makes the policy uniform so a future spike doesn’t leak.

### Part B — Editor-credit guardrails (the real lever)
Codify behavior in `mem://~user` (your personal preferences, applies to every project) so I stop burning credits on exploration when you ask narrow questions. Concretely, I’d add:

- **Narrow-question rule:** if your message names a specific file/symbol/error, I answer or fix in-place — no codebase sweep, no extra file reads, no plan unless asked.
- **Diagnose-before-fix rule:** when something external is failing (CI, deploy, GitHub), reproduce the exact failing command or pull the actual error log first; never propose a fix from inference.
- **No re-summarizing:** I don’t restate context already loaded in the message.
- **Plan-mode default for ambiguous asks:** flat 1 credit to align scope is cheaper than a wrong build pass.
- **Stop on first green signal:** when a fix verifies (build/test/log), I stop — no extra polish, no tangential cleanups.

These go into your user-level memory so they apply across every project, not just AWIP.

### What I will NOT do
- No new dashboards, no “credit usage” page, no cron job to track Lovable editor credits (that data isn’t exposed to the app).
- No model swap on `companion-cloud-chat` defaults — operator picks the model there intentionally.
- No changes to TTS routing (already exempt by design).

### Risk
Low. Part A is three localized edits behind an existing helper; Part B is memory text only.

### Expected outcome
- AI Gateway: night-mode coverage goes from “most” to “all” jobs.
- Editor credits: fewer wasted exploration turns on narrow asks; faster, cheaper responses.