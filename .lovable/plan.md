## Goal
Surface threshold breaches directly on the Daily AI spend chart so operators can see at a glance which days/jobs exceeded the configured cost limits.

## Scope
Frontend only — `src/components/AutomationPanel.tsx`, inside `DailyAiSpendCard` and its drill-down. No schema changes; the thresholds already exist:
- `alert_settings.cost_per_day_usd` — global daily ceiling.
- `alert_cost_thresholds.cost_per_day_usd` / `cost_per_run_usd` per `job` (with `alert_on_cost` flag).

## Data
- On mount, fetch in parallel with the existing usage query:
  - `alert_settings` (single row) → `globalDailyLimit`, `globalPerRunLimit` (uses `cost_per_run_usd`).
  - `alert_cost_thresholds` (all rows where `alert_on_cost = true`) → map `{ job → { day, run } }`.
- Subscribe via realtime to both tables so edits in the existing Cost thresholds UI live-update the chart.

## Visual treatment

### 1. Daily total breach (global `cost_per_day_usd`)
- Draw a dashed horizontal **threshold line** across the chart at the value (positioned by `value / maxDay` height). Color: `hsl(var(--destructive))`. Right-edge label: `daily limit $X.XX`.
- For any day whose total > limit, tint that bar's background container with `bg-destructive/10` and add a `ring-1 ring-destructive/40`. Tooltip appends: `⚠ over daily limit by $Y`.

### 2. Per-job breach (per-job `cost_per_day_usd`)
- When `groupBy === "job"`: for each (day, job) cell whose cost > job threshold, overlay a thin `outline-1 outline-destructive` ring on the segment and prepend `⚠` to the segment tooltip line.
- When `groupBy === "model"`: per-job thresholds aren't directly applicable; show a small note under the chart: `Switch to "by job" to see per-job threshold breaches.` (Only when any job threshold exists.)

### 3. Per-run breach (per-run cost)
- Surfaced inside the **drill-down dialog** only (not the bar chart): rows whose `cost_usd > effectivePerRunLimit(job)` get a `bg-destructive/5` row tint and a `⚠ over per-run limit ($Z)` chip in the Cost cell. `effectivePerRunLimit` = job-specific override if set, else global.

### 4. Breach summary chip (header)
- Add a 5th compact chip in the summary grid (adjusts to `sm:grid-cols-5`): **Breaches** showing `Nday · Mjob · Krun` counts within the current range. Clicking it opens the drill-down dialog filtered to all breaching rows for the range (new drill state shape `{ day: string | "*"; groupKey: string | null; breachOnly?: boolean }`).

### 5. Legend / threshold badge
- Below the chart, add a tiny inline legend: `— daily limit $X.XX  ·  ⚠ = job breach`. Hidden when no thresholds are configured.

## Implementation outline
1. New state in `DailyAiSpendCard`:
   ```ts
   const [globalLimits, setGlobalLimits] = useState<{ day: number | null; run: number | null }>({ day: null, run: null });
   const [jobLimits, setJobLimits] = useState<Record<string, { day: number | null; run: number | null }>>({});
   ```
2. New `useEffect` (no deps) loads both tables and subscribes to `postgres_changes` on `alert_settings` and `alert_cost_thresholds`.
3. Compute derived sets once per render:
   - `dayBreaches: Set<string>` of dayKeys where `dailyTotals[i] > globalLimits.day`.
   - `cellBreaches: Set<"day|job">` for per-job daily breaches.
   - `runBreachOf(row)` helper for the drill-down.
4. Render threshold line as an absolutely-positioned `<div>` inside a `relative` wrapper around the bar row. Height: `100% - 12px` (account for label row); `bottom: <pct>%`.
5. Apply tints/rings using semantic destructive tokens — no hex colors.
6. Extend `SpendDrillDialog` to accept `globalLimits`, `jobLimits`, and an optional `breachOnly` filter; filter rows accordingly when set; render the per-row chip + tint.
7. Header chip click sets `drill = { day: "*", groupKey: null, breachOnly: true }`. Update the dialog's filtering logic to treat `day === "*"` as "any day in current range" and `breachOnly` to keep only rows that hit per-run / per-day breaches.

## Out of scope
- Editing thresholds inline (already lives elsewhere in the app).
- Email/webhook alerts (already handled server-side).
- Forecasting future breaches.
- Hourly granularity.

## Validation
- Set `alert_settings.cost_per_day_usd = 0.05` and confirm a dashed line appears, breaching bars get red tint, and header shows correct day count.
- Set a `alert_cost_thresholds` row for `scheduled-code-review` with a tiny `cost_per_day_usd`; switch to `by job` and confirm the matching segment gets a destructive outline.
- Switch to `by model` → see the helper note, no segment outlines.
- Click the Breaches chip → dialog opens with only breaching rows; verify per-run chip + row tint.
- Edit a threshold elsewhere in the UI → chart updates without reload (realtime).
- Clear all thresholds → line, tints, legend, and chip disappear cleanly.
