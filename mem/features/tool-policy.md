---
name: tool-policy
description: Tool selection policy (Lovable/Claude/Cursor/Codex/manual) per task. Editable rules + credit signals. Tab on /admin/ai-usage.
type: feature
---

**Surface:** "Tool Policy" tab on `/admin/ai-usage`.

**Tables:**
- `tool_policy_rules` — precedence-ordered editable rules. Conditions: `task_types[]`, `phase_ids[]`, `min/max_credits_remaining_pct`, `min_burn_rate_per_day`. Operator-only RLS. Realtime on.
- `tool_policy_recommendations` — log of operator-chosen recommendations with full score_breakdown.

**View (SECURITY INVOKER):**
- `v_tool_policy_signals` — single-row: `mtd_credits`, `budget`, `remaining_pct`, `burn_7d_per_day`, `projected_month_end`. Sourced from `v_credit_burn_per_step` + `credit_settings`.

**Recommender:** `src/lib/toolPolicy.ts` — deterministic. Sort enabled rules by precedence asc; first all-conditions-pass wins; falls back to `lovable`. No AI call.

**Tools:** `lovable | claude | cursor | codex | manual`.

**Task types:** `new_feature | refactor | bug_fix | ui_tweak | pure_logic | tests | docs | migration | edge_fn`.

**Seed rules:** credit conservation ≤15%→Claude; ui_tweak→Lovable; migration/edge_fn→Lovable; refactor + burn≥5→Claude; tests/docs→Claude; pure_logic + remaining≤40%→Claude; new_feature→Lovable; fallback→Lovable.

**Out of scope:** auto-switching, real Claude/Cursor/Codex usage import, AI-generated rules, sentinel finding for ignored policy (later from `tool_policy_recommendations`).
