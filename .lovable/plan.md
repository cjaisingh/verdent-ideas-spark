## Goal
Make stacked-bar segments in the Daily AI spend card clickable. Clicking opens a drill-down dialog listing the individual `ai_usage_log` runs for that (day × group key) cell, with tokens, model, and the exact cost formula.

## Scope
Frontend-only change in `src/components/AutomationPanel.tsx`. No schema, RLS, or edge function changes — `ai_usage_log` already has `prompt_tokens`, `completion_tokens`, `price_in_per_mtok`, `price_out_per_mtok`, `cost_usd`, `latency_ms`, `status`, `request_ref`, and is operator-readable.

## UX
- Each segment in the stacked bar gets `cursor-pointer` and an `onClick` that opens a shadcn `Dialog`.
- Whole-bar click (clicking the muted background area) opens the dialog scoped to that day across all groups.
- Dialog title: `Aug 12 · by job · scheduled-code-review` (day + grouping + segment key, or "All groups" for whole-bar).
- Header summary chips: total cost, total tokens, call count, night-mode count.
- Table columns:
  - Time (HH:MM:SS UTC)
  - Job
  - Model (with a small "night" badge when `request_ref.night_mode === true`)
  - Status (ok / error pill, tooltip with `error` text if present)
  - Prompt tok
  - Completion tok
  - Latency (ms)
  - Cost (USD, 6dp)
  - **Formula** — rendered as `(p/1e6 × $price_in) + (c/1e6 × $price_out) = $cost`, e.g. `(1,204/1M × $0.10) + (532/1M × $0.40) = $0.000333`. Shown muted/mono. Falls back to `—` if either price column is null.
- Rows sorted newest first. Capped at 200 with a "+N more" footer note (drill-downs for a single cell rarely exceed this).
- Empty state: "No runs in this slice."

## Data flow
- The card already loads up to 5,000 rows for the chosen window. Reuse those in-memory rows — no extra round-trip.
- New local state: `drill: { day: string; groupKey: string | null } | null`.
- Filtering: `rows.filter(r => r.created_at.slice(0,10) === day && (groupKey === null || groupKeyOf(r) === groupKey))`.
- To get `price_in_per_mtok` / `price_out_per_mtok` / `latency_ms` / `status` / `error` / `request_ref`, extend the existing `select(...)` and `SpendRow` type with those columns. (Same query, more fields.)

## Implementation outline
1. Extend `SpendRow` type and the `.select()` string.
2. Add `Dialog` imports (`@/components/ui/dialog`) and a `Table` (`@/components/ui/table`) — both already used elsewhere in the codebase.
3. Add `drill` state and `openDrill(day, groupKey)` helper.
4. Wire `onClick` on each `<div>` segment and on the bar wrapper.
5. Add a `<DrillDialog>` subcomponent in the same file that takes `rows`, `day`, `groupKey`, formats the formula, and renders the table.
6. Keep existing realtime subscription — when new rows stream in, the dialog list updates because it derives from `rows`.

## Out of scope
- No CSV export (can be a follow-up).
- No editing or re-running entries from the dialog.
- No changes to backend, types, or other panels.

## Validation
- Click a colored segment → dialog opens with only that group's runs for that day; cost sum in the header matches the segment tooltip total.
- Click a sparse day's bar background → dialog lists all runs for that day.
- Verify formula renders correctly for: night-mode flash-lite call, a row missing prices (shows `—`), and an `error` row (status pill + tooltip).
- Toggle `by job` ↔ `by model` and re-open → drill respects the active grouping.
