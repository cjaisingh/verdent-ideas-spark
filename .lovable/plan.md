
# Tool Selection Policy

A "Tool Policy" tab on `/admin/ai-usage` that recommends Lovable / Claude / Cursor / Codex per task, driven by editable rules + live credit signals.

## Surface

New tab `Tool Policy` next to `Credits & Usage` on `/admin/ai-usage`. Three sections:

1. **Recommend a tool** (top) — operator picks task type, optional phase. Card shows the winning tool, score, reasoning bullets, and the rule that fired.
2. **Signals strip** — MTD credits used, remaining vs budget, 7d burn/day, projected month-end. Pulled from `credit_settings` + `v_credit_burn_per_step`.
3. **Rules table** — editable list of `tool_policy_rules`. Add / edit / disable / reorder by precedence.

## Database (one migration)

### `tool_policy_rules`
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | "Bulk refactor → Claude" |
| precedence | int | lower wins ties |
| task_types | text[] | matches operator pick: `new_feature`, `refactor`, `bug_fix`, `ui_tweak`, `pure_logic`, `tests`, `docs`, `migration`, `edge_fn` |
| phase_ids | uuid[] nullable | optional scope |
| min_credits_remaining_pct | int nullable | rule fires only if remaining ≥ X% |
| max_credits_remaining_pct | int nullable | rule fires only if remaining ≤ X% |
| min_burn_rate_per_day | numeric nullable | fires only if 7d burn ≥ X |
| recommended_tool | text | `lovable` / `claude` / `cursor` / `codex` / `manual` |
| reasoning | text | shown verbatim in recommendation card |
| enabled | bool default true |
| created_at / updated_at | timestamptz | |

RLS: operator-only (`has_role(auth.uid(),'operator')`) for all ops. Realtime on.

### `tool_policy_recommendations` (log)
| col | type |
|---|---|
| id, created_at | uuid, timestamptz |
| operator_id | uuid |
| task_type | text |
| phase_id | uuid nullable |
| credits_remaining_pct | numeric |
| burn_rate_per_day | numeric |
| chosen_tool | text |
| chosen_rule_id | uuid nullable |
| score_breakdown | jsonb |

Operator-only RLS. Insert on every recommendation. Used later to back a "policy accuracy" view (out of scope now).

### `v_tool_policy_signals` (security_invoker view)
Returns single row: `mtd_credits`, `budget`, `remaining_pct`, `burn_7d_per_day`, `projected_month_end`. Sources: `credit_entries`, `credit_settings`, `v_credit_burn_per_step`.

### Seed rules (inserted in same migration)
| precedence | name | when | → tool |
|---|---|---|---|
| 10 | Critical credit conservation | remaining_pct ≤ 15 | `claude` |
| 20 | UI tweaks stay on Lovable | task=`ui_tweak` | `lovable` |
| 30 | Migrations stay on Lovable | task=`migration` or `edge_fn` | `lovable` |
| 40 | Bulk refactor → Claude | task=`refactor`, burn ≥ 5/day | `claude` |
| 50 | Tests + docs → Claude | task in (`tests`,`docs`) | `claude` |
| 60 | Pure logic → Claude when squeezed | task=`pure_logic`, remaining ≤ 40% | `claude` |
| 70 | New feature default | task=`new_feature` | `lovable` |
| 999 | Fallback | always | `lovable` |

## Recommender logic (client-side)

Pure TS in `src/lib/toolPolicy.ts`:

1. Load `tool_policy_signals` row + enabled rules ordered by precedence.
2. For each rule, evaluate all conditions (task type match, phase match, credit %, burn). All conditions must pass.
3. First matching rule wins. Returns `{ tool, rule, reasoning, score_breakdown }`.
4. On submit, insert into `tool_policy_recommendations`.

Deterministic, no AI call — keeps it cheap and auditable.

## Files

**New**
- `supabase/migrations/<ts>_tool_policy.sql`
- `src/lib/toolPolicy.ts` (recommender)
- `src/lib/toolPolicy.test.ts` (rule evaluation unit tests)
- `src/components/admin/ToolPolicyPanel.tsx` (signals + recommender form + result card)
- `src/components/admin/ToolPolicyRulesTable.tsx` (CRUD)
- `src/components/admin/EditToolPolicyRuleDialog.tsx`
- `docs/tool-policy.md`
- `mem/features/tool-policy.md`

**Edited**
- `src/pages/AdminAiUsage.tsx` — add third tab
- `CHANGELOG.md`
- `mem://index.md` — link new memory

## Out of scope

- Auto-switching tools (this is advisory only).
- Pulling real Claude/Cursor/Codex usage (no APIs wired).
- AI-generated rules — rules are operator-authored.
- Sentinel finding when policy is consistently ignored — can add later from `tool_policy_recommendations` log.
