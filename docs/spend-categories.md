# Spend categories

Each `credit_entries` row carries a **`category`** (`work_category` enum) so
the Credits tab can answer "what kind of work is burning my credits?".

## Enum values

`plan` · `build` · `pivot` · `refactor` · `bugfix` · `research` · `ops` · `other`

Default is `build` (covers legacy rows). Categories are **orthogonal** to
`mode` (`build`/`plan`/`try-to-fix`/`other`) — `mode` is the Lovable run mode,
`category` is the nature of the work.

## Per-task default

`roadmap_tasks.default_category` (nullable) pre-selects the category in the
Log Credits dialog when an operator picks a task. Useful for tasks you already
know are mostly refactor or pivot work.

## View

`public.v_credit_spend_by_category` (security invoker):

| column | meaning |
|---|---|
| `category` | one of the enum values |
| `mtd_credits` | sum for the current calendar month |
| `mtd_pct` | share of MTD total |
| `last_30d_credits` | sum for last 30 days |
| `last_30d_pct` | share of 30d total |
| `entry_count_30d` | number of rows in last 30 days |

Proxy rows (token-derived) don't carry a category and are excluded from this
view — only operator-logged credits are categorised.

## UI

`SpendByCategoryPanel` on `/admin/ai-usage` → Credits & Usage. Horizontal bar
chart + table; click a bar or row to filter the per-step table below by that
category. Window toggle MTD/30d (default 30d).
