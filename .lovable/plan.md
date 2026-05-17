## Spend categories (plan/pivot/refactor/…)

Tag each `credit_entries` row with a **work category** so the Credits & Usage tab can show which categories burn the most. Categorising at the **credit entry** level (not the task) because one task often spans plan→build→refactor and you want each logged credit attributed to what it actually was.

### Schema

New enum + column on `credit_entries`:

```sql
CREATE TYPE work_category AS ENUM ('plan','build','pivot','refactor','bugfix','research','ops','other');
ALTER TABLE credit_entries ADD COLUMN category work_category NOT NULL DEFAULT 'build';
CREATE INDEX idx_credit_entries_category ON credit_entries(category);
```

Defaults to `build` so existing rows stay valid. `mode` (build/plan/try-to-fix/other) stays — it's the Lovable run mode, orthogonal to category.

Also add an optional **default category** on `roadmap_tasks` so the "Log credits" dialog can pre-select sensibly:

```sql
ALTER TABLE roadmap_tasks ADD COLUMN default_category work_category;
```

### View

`v_credit_spend_by_category` — single read-only view, MTD + 30d windows:

```text
category,
mtd_credits, mtd_pct,
last_30d_credits, last_30d_pct,
entry_count_30d
```

`mtd_pct` and `last_30d_pct` are the category's share of total spend in that window. Security invoker, operator-only via underlying RLS.

### UI

**1. `AddCreditEntryDialog`** — add a category dropdown (8 options, default = task's `default_category` or `build`).

**2. New `SpendByCategoryPanel`** on `/admin/ai-usage` → Credits & Usage tab, between `ProjectedSpendPanel` and the existing phase rollup. Shows:
- Horizontal bar chart (Recharts) — categories sorted by 30d credits descending, with MTD overlay.
- Table beneath: category · MTD · 30d · % of 30d · count. Click a row to filter the recent-entries table below (in-page filter, no URL change).
- Window toggle (MTD / 30d) — default 30d.

**3. `CreditsUsagePanel` recent-entries table** — add a "Category" column with a coloured chip.

### Files

- New migration (enum, column, default, index, view).
- New `src/components/admin/SpendByCategoryPanel.tsx`.
- Edit `src/components/admin/AddCreditEntryDialog.tsx` — category select.
- Edit `src/components/admin/CreditsUsagePanel.tsx` — mount panel, add column, add filter state.
- Edit `CHANGELOG.md`, `docs/credits-usage.md` (new section), `mem/features/credits-usage.md`.

### Out of scope

- Backfilling existing rows beyond the `build` default (you can re-categorise via direct DB edit if needed; no UI for bulk re-tag).
- Per-category budgets or alerts.
- Tagging the **tool** used (Lovable/Claude/Cursor) — that lives in the Tool Policy table already.
- Forecasting per category — projection panel stays overall-only.

### Questions before I build

None — the spec is concrete enough. Approve to ship.
