# Tool Selection Policy

Operator-only tab on `/admin/ai-usage` ("Tool Policy") that recommends Lovable / Claude / Cursor / Codex / manual per task, driven by editable rules and live credit signals.

## Why

You're paying for Lovable per-credit and (potentially) Claude Max at a flat fee. The policy makes the "which tool now?" decision explicit, deterministic, and auditable rather than vibes-based.

## Data model

| Object | Purpose |
|---|---|
| `tool_policy_rules` | Ordered (precedence asc) editable rules. First match wins. |
| `tool_policy_recommendations` | Log of every recommendation operator chose to record. |
| `v_tool_policy_signals` | Single-row view: MTD credits, budget, remaining %, 7d burn/day, projected month-end. |

All access operator-only via `has_role()`. `tool_policy_rules` is realtime.

## Rule shape

- `task_types[]` — empty = match any (`new_feature`, `refactor`, `bug_fix`, `ui_tweak`, `pure_logic`, `tests`, `docs`, `migration`, `edge_fn`).
- `phase_ids[]` — optional scope to specific roadmap phases.
- `min_credits_remaining_pct` / `max_credits_remaining_pct` — fires only inside the band. Skipped if signal is null.
- `min_burn_rate_per_day` — fires only when 7d burn is at or above. Skipped if signal is null.
- `recommended_tool` — `lovable` / `claude` / `cursor` / `codex` / `manual`.
- `reasoning` — free text shown verbatim when the rule fires.

## Recommender

`src/lib/toolPolicy.ts` — pure TS, no AI call. Sorts enabled rules by precedence, first all-conditions-pass wins. Falls back to `lovable` with reasoning "no rule matched".

Unit tests in `src/lib/toolPolicy.test.ts`.

## Seeded rules

| # | When | → |
|---|---|---|
| 10 | remaining ≤ 15% | Claude |
| 20 | task = ui_tweak | Lovable |
| 30 | task = migration / edge_fn | Lovable |
| 40 | task = refactor, burn ≥ 5/day | Claude |
| 50 | task = tests / docs | Claude |
| 60 | task = pure_logic, remaining ≤ 40% | Claude |
| 70 | task = new_feature | Lovable |
| 999 | fallback | Lovable |

## What this is NOT

- Not auto-switching. Advisory only.
- Does not pull real Claude/Cursor/Codex usage (no APIs wired).
- Not AI-generated rules. Operator authors them.
