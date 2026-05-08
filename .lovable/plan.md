## Goal
Add a metric toggle to the Daily AI spend card so the stacked bar chart and breakdown can show **Spend (USD)**, **Prompt tokens**, or **Completion tokens** — not just spend.

## Scope
Frontend only — `src/components/AutomationPanel.tsx` (`DailyAiSpendCard` + small tweaks to `SpendDrillDialog` header label). No schema changes, no new data fetches (rows already include `prompt_tokens` and `completion_tokens`).

## UX
- New small segmented control in the header, placed just to the left of the existing `by job / by model` toggle:
  ```
  [ $ Spend | Prompt tok | Completion tok ]   [ by job | by model ]
  ```
- Default = `spend` (current behavior).
- Persists only in component state (no localStorage), matching how `groupBy` works today.

## Behavior changes when metric ≠ spend
- The stacked bar chart sums the selected metric per `day × group` instead of `cost_usd`. Bar heights, segment heights, tooltips, and the y-axis-implied max all switch to that metric.
- The **Breakdown** list under the chart shows the metric total per group with token formatting (`toLocaleString()`) instead of `fmtUsd6`.
- The "Total" and "Avg / day" summary chips reflect the selected metric (formatted as tokens when applicable). The existing **Tokens** and **Runs** chips stay as-is. The **Breaches** chip stays as-is (breaches are always cost-defined).
- Threshold visuals (dashed daily-limit line, destructive bar tint, ⚠ markers, job-day breach outlines) **only render when metric = spend**, since thresholds are cost-based. When metric is a token view, the chart hides threshold overlays and the legend note.
- Tooltip lines switch units (`$0.001234` vs `12,345 tok`).

## Implementation notes
- Add `const [metric, setMetric] = useState<"spend" | "prompt" | "completion">("spend")`.
- Helper `valueOf(r: SpendRow)` returning `cost_usd`, `prompt_tokens`, or `completion_tokens` based on `metric`.
- Replace the inline `Number(r.cost_usd || 0)` accumulation in the matrix loop with `valueOf(r)`. Keep a separate cost accumulator for the Breaches chip + threshold logic so they remain correct regardless of metric.
- Format helper `fmtMetric(n)` → `fmtUsd6(n)` when spend, else `n.toLocaleString() + " tok"`.
- Gate threshold rendering blocks (`dailyLimitPct` line, `dayBreaches`/`cellBreaches` styling, ⚠ markers, legend hints) behind `metric === "spend"`.
- `SpendDrillDialog` is unchanged in data, but pass `metric` through so its header subtitle reads e.g. `… · viewing prompt tokens` for context (rows still show all columns).

## Out of scope
- Per-token threshold alerts.
- Combined "total tokens" view (sum of prompt + completion) — can be added later if requested.
- Switching the y-axis to a fixed scale or showing absolute axis numbers.

## Validation
1. Toggle to **Prompt tok** — bars rescale; breakdown shows token counts; tooltip says `… tok`; threshold line disappears.
2. Toggle to **Completion tok** — same, with completion totals.
3. Toggle back to **Spend** — chart and threshold overlays match current behavior exactly.
4. Change date range and `by job ↔ by model` while on a token metric — grouping/labels still update correctly.
5. Click a bar segment — drill-down opens with header noting the active metric; row table still shows full data.