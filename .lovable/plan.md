## Goal

Track Lovable credit burn per build step on `/admin/ai-usage`, combining manual operator entries (real credit numbers) with a proxy computed from `roadmap_work_log` tokens.

**Honest constraint up front:** Lovable does not expose your billing API to this project. The "proxy" is `tokens_total × configurable_rate` — it is a *signal*, not a real credit count. Real numbers come from your manual entries (and optionally pasted billing exports). The UI labels both clearly so you never confuse them.

## What gets built

### 1. Database (one migration)

**`credit_entries`** — manual ledger
- `task_id` (nullable fk → `roadmap_tasks`)
- `phase_id` (nullable fk → `roadmap_phases`) — denormalised for rollup speed
- `step_label` (text) — free-text e.g. "W7 sidebar chip"
- `credits` (numeric) — actual credits spent
- `mode` (text: `build` | `plan` | `try-to-fix`)
- `note` (text)
- `occurred_at`, `created_by`, `created_at`
- RLS: operator-only read/write

**`credit_settings`** — singleton row
- `proxy_rate_per_1k_tokens` (numeric, default 0.05) — operator-tunable
- `monthly_budget_credits` (integer, nullable) — drives alert
- `alert_threshold_pct` (integer, default 80)
- RLS: operator-only

**`v_credit_burn_per_step`** — view
- Unions `credit_entries` (source=`manual`, `credits` direct) with `roadmap_work_log` (source=`proxy`, `credits = tokens_total / 1000 × proxy_rate`)
- Columns: `occurred_at, task_id, phase_id, step_label, source, credits, tokens_total, model, duration_ms`

**`v_credit_burn_per_phase_30d`** — view
- Rollup by `phase_id` over last 30d, with `manual_credits`, `proxy_credits`, `total_credits`

### 2. Page

Add a new tab to `src/pages/AdminAiUsage.tsx` ("Credits & Usage") using existing Tabs component. Three sections in the tab:

1. **Header strip** — Month-to-date totals (manual + proxy, separately), budget remaining, alert badge if burn ≥ threshold.
2. **Per-step table** — sortable by date / phase / step / source / credits. Source column shows `manual` (green) vs `proxy` (amber) chip. "Add entry" button opens a dialog (task picker + step label + credits + mode + note).
3. **Per-phase rollup** — bar list of top phases by total credits (manual+proxy), 30d window.
4. **30-day trend chart** — Recharts line chart, two series (manual, proxy), x = day, y = credits.
5. **Settings drawer** — proxy rate, monthly budget, alert threshold.

No new sidebar entry — lives under existing AI Usage page.

### 3. No edge function needed

All reads via supabase client against the two views. Writes via direct inserts to `credit_entries` / updates to `credit_settings`. No cron, no AI calls, no external API.

### 4. Out of scope (explicitly)

- Auto-detecting Lovable credit usage from billing — no API exists.
- CSV import from Lovable billing export — deferred until you confirm you'd actually use it.
- Slack/Telegram alert webhook on budget breach — can layer later via existing automation pattern.
- Backfill of historical credits — manual entries start from creation date forward.

## Files touched

- **Migration** (new) — tables, views, RLS, seed `credit_settings` row.
- **`src/pages/AdminAiUsage.tsx`** — add Tabs wrapper if not already present, add "Credits & Usage" tab.
- **`src/components/admin/CreditsUsagePanel.tsx`** (new) — the tab body (header strip + table + rollup + chart + settings).
- **`src/components/admin/AddCreditEntryDialog.tsx`** (new) — entry form.
- **`mem/features/credits-usage.md`** (new) — feature memory.
- **`mem/index.md`** — append entry.
- **`docs/credits-usage.md`** (new) — short doc on what the proxy is/isn't.
- **`CHANGELOG.md`** — entry.

## Risks / things to watch

- **Proxy honesty**: amber-chip every proxy row and put the rate next to the total. If you ever stop trusting it, set `proxy_rate_per_1k_tokens = 0` and the proxy series collapses to zero.
- **`roadmap_work_log.tokens_total` is sometimes null** — view treats null as 0, so old rows simply don't contribute.
- **No phase_id on `roadmap_work_log`** — view derives it via `roadmap_tasks.phase_id` join. Tasks with null phase appear in "unassigned" bucket.

## Acceptance

- Tab visible at `/admin/ai-usage` under "Credits & Usage".
- Adding a manual entry shows up in the table immediately and rolls into header totals.
- Proxy rows appear for any work_log entry with `tokens_total > 0`.
- Setting `monthly_budget_credits = 100` and breaching 80% lights the alert badge.
- Operator-only — non-operator sees the existing AI Usage tab but the Credits & Usage tab returns empty.
