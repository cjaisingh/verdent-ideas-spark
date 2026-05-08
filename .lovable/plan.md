## Goal
On the Daily AI spend card (`/ai-usage`), always render the chart skeleton — day-labeled axis, baseline, and (when in spend mode) the daily-limit threshold line — even when `ai_usage_log` has zero rows in the selected range. Replace the current "No ai_usage_log entries…" text-only empty state.

## Scope
Frontend only — `src/components/AutomationPanel.tsx`, inside `DailyAiSpendCard`. No data, schema, or API changes. Toggles, summary chips, and drill-down behavior unchanged.

## Behavior
- When `rows.length === 0` (and not loading):
  - Still render the stacked-bar container at full `h-32`, with one empty column per day in the range.
  - Each column shows the muted bar background (`bg-muted/40`) at 0 height (just the baseline) and the day label underneath, using the same sparse-label rule as the populated chart.
  - In spend mode, if a global daily limit exists, render the dashed threshold line (full-height since `maxDay` falls back to the limit) with the existing `daily limit $X` label.
  - Below the chart, show a single muted line: `No ai_usage_log entries in this range.` (replaces the current standalone empty-state block).
  - Skip the breakdown table entirely when there's nothing to break down.
- When `loading`, keep the existing "Loading…" line (no skeleton flash).
- When `rows.length > 0`, behavior is unchanged.

## Implementation notes
- Drop the `rows.length === 0` branch from the top-level conditional and instead always enter the chart render path once `!loading`.
- In `maxDay`, fall back to `globalLimits.day ?? 1` when all `dailyTotals` are 0 so the dashed threshold line still renders at a sensible position.
- Guard the breakdown `<table>` with `breakdown.length > 0`.
- Show the empty-state caption (`"No ai_usage_log entries in this range."`) just under the chart legend area when `rows.length === 0`.
- Keep the `capped` warning banner where it is (only relevant when rows exist).

## Validation
1. Visit `/ai-usage` with empty `ai_usage_log` → see day-labeled axis + (if a daily cost limit is set) the dashed limit line + empty-state caption. Toggling metric/groupBy/date range still re-renders the axis without errors.
2. Insert one row → that day's bar renders at full height; other days remain empty; breakdown table appears.
3. Switch to "Prompt tok" / "Completion tok" with empty data → axis still renders, threshold line is hidden (consistent with existing token-mode behavior), caption shows.
4. Loading state still shows "Loading…" only (no skeleton flicker).