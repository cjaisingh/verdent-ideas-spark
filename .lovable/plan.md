## Goal
Replace the fixed 7/14/30-day toggle on the Daily AI spend card with a flexible date range picker, so any start/end date pair can be queried.

## Scope
Frontend only — `src/components/AutomationPanel.tsx`, `DailyAiSpendCard`. No schema, RLS, or edge function changes. The drill-down dialog continues to use the in-memory `rows` and works unchanged.

## UX
- Replace the `[7d | 14d | 30d]` segmented control with:
  - A **range Popover trigger** button: `Aug 01 → Aug 14 (14d)`. Icon: `CalendarIcon` from lucide.
  - Inside the popover: shadcn `Calendar` with `mode="range"` (`pointer-events-auto`), constrained `disabled={d => d > today || d < oneYearAgo}`.
  - Quick presets row above the calendar: **7d · 14d · 30d · 90d · This month · Last month**. Clicking a preset sets the range and closes the popover.
  - Footer: **Apply** + **Cancel**. Apply only enabled when both `from` and `to` are set.
- Selected range is shown as button label and persists per-session in `localStorage` key `awip.spend.range` (`{ from, to }` ISO strings).
- The "by job / by model" toggle stays as-is, to its right.
- The four summary chips keep working; "Avg / day" divides by `(to - from + 1)` days instead of the old fixed `days`.

## Data flow
- Replace `days` state with `range: { from: Date; to: Date }` (default = last 14d, ending today UTC).
- The query becomes:
  ```ts
  .gte("created_at", startOfUtcDay(range.from).toISOString())
  .lt("created_at", endExclusiveUtcDay(range.to).toISOString())
  ```
  i.e. inclusive of both day buckets.
- `dayKeys` is built by walking `range.from → range.to` UTC inclusive.
- Row cap stays at 5,000. If the response hits 5,000 we surface a small inline warning: `"Showing first 5,000 rows for this range — narrow the dates for full totals."` (detected when `data.length === 5000`).
- Realtime subscription on `ai_usage_log` INSERT remains and triggers `load()` (which respects the current range).

## Implementation outline
1. Add imports: `Calendar`, `Popover/PopoverTrigger/PopoverContent`, `Button`, `CalendarIcon`, `format` from `date-fns` (already a dependency).
2. New helpers (top of file or local): `startOfUtcDay(d)`, `endExclusiveUtcDay(d)`, `utcDayKey(d) → "YYYY-MM-DD"`, `daysBetweenInclusive(a,b)`, `enumerateUtcDays(from,to)`.
3. Refactor `DailyAiSpendCard`:
   - State: `range`, draft `pendingRange` while popover open, `popoverOpen`.
   - `dayKeys = enumerateUtcDays(range.from, range.to)`.
   - Replace fixed `days` math with `daysSpan = dayKeys.length`.
   - Persist/restore `range` from `localStorage` on mount.
4. New small subcomponent `<SpendRangePicker value pendingValue onApply onCancel presets />` rendered inside the popover. Presets implemented as plain buttons calling `onApply(preset)` directly.
5. Empty/loading text uses the formatted range, not "last N days".
6. Bar widths: when range is large (e.g. 90d), bar gap shrinks (`gap-0.5`) and day labels switch to every-7th tick to avoid clutter. Threshold: `daysSpan > 31 → sparse labels`.

## Out of scope
- No comparison range / overlay (current vs previous period).
- No timezone selector — stays UTC to match the rest of the panel.
- No URL query-string sync (localStorage only).
- No CSV export.

## Validation
- Pick a 3-day range with known activity → totals match a `SELECT sum(cost_usd)` over the same window.
- Pick "This month" on the 1st of the month → renders a single-day bar with no NaN.
- Pick a 90-day range → labels render sparsely, chart doesn't overflow.
- Pick a future-end / inverted range → Apply disabled (calendar prevents future, range mode prevents inverted).
- Click a bar segment → drill-down dialog still shows the right rows for that day×group.
- Reload page → the previously selected range is restored from localStorage.
- Hit a 5,000-row range (e.g. last 90d on a heavy account) → warning chip appears.
