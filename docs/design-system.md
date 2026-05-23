# Design system

The yardstick every operator-facing page is measured against. Short on theory,
long on copy-pastable defaults. When in doubt, do what this doc says.

Companion docs: [operator-sidebar](./operator-sidebar.md), [operator-panes](./operator-panes.md), [operator-dashboard](./operator-dashboard.md).

---

## 1. Principles

1. **Monochrome by default.** Pages render in `background` / `foreground` / `muted` /
   `border`. Colour shows up only when it carries meaning.
2. **Tints are signals, not decoration.** The seven `tint-*` tokens are reserved
   for status, category, or source identity. Never use them for hero panels,
   buttons, or page chrome.
3. **Density over padding.** This is an operator console, not a marketing site.
   Default to compact spacing; reach for `py-12` only when the page is
   intentionally a single hero (Auth, NotFound).
4. **One active treatment per surface.** A row, a tab, a card, a pane — only one
   thing in it should look "selected" at a time. Borrowed straight from the
   sidebar rules and applied everywhere else.
5. **Realtime, not refresh.** If a page shows a list backed by a Supabase table,
   it subscribes to that table. Manual refresh buttons are a smell.

---

## 2. Page layout

### Canonical container

```tsx
<main className="mx-auto w-full max-w-7xl px-4 py-4 space-y-6">
  {/* page header */}
  {/* sections */}
</main>
```

- `max-w-7xl` (1280px) is the default. Use `max-w-5xl` for read-heavy pages
  (single doc, single detail panel). Use `max-w-none` only for full-bleed
  surfaces (Control Plane stream, BentoGrid, big tables).
- `px-4 py-4` is the minimum. Bump to `px-6` only on `>1280px` reading layouts.
- `space-y-6` between page sections.

### When to break the container

Allowed:
- Tables / streams that need every pixel of width (Events, Control Plane, DB explorer).
- The bento dashboard (its own grid system).
- Full-screen modals or onboarding routes.

Not allowed:
- Adding `py-12` "to give it room". Density is the brand.
- Per-page `max-w-` invented from feel. Use one of the three above.

---

## 3. Page header pattern

Every page (not panes, not cards) ships the same header skeleton:

```tsx
<header className="flex items-start justify-between gap-4">
  <div className="space-y-1">
    <h1 className="text-xl font-semibold leading-none">Jobs board</h1>
    <p className="text-sm text-muted-foreground">
      Open discussion actions across copilots.
    </p>
  </div>
  <div className="flex items-center gap-2">
    {/* actions: filters, primary CTA */}
  </div>
</header>
```

Rules:
- One `h1` per page. `text-xl font-semibold` — not `text-3xl`.
- Subtitle optional, never a paragraph. One sentence, `text-sm text-muted-foreground`.
- Actions row always right-aligned. Primary action last.
- No icons in `h1`. Status pills go in the actions row.

---

## 4. Spacing scale

Use these. Don't invent new ones.

| Where | Class | Notes |
|---|---|---|
| Between page sections | `space-y-6` | The default rhythm |
| Inside a `<Card>` | `space-y-3` | Header → body → footer |
| Inline elements (header row) | `gap-2` | Buttons, badges, pills |
| Tight vertical lists (table rows) | `space-y-1` | Or `divide-y divide-border/60` |
| Form fields | `space-y-4` | Label/input pairs |

Heights:

| Surface | Height |
|---|---|
| Page header (`OperatorLayout`) | `h-12` |
| Pane header | `h-9` |
| Table header | `h-8` |
| Table row | `h-8` (text-xs) |
| Toolbar button | `h-7` icon, `h-8` with label |

---

## 5. Cards vs bare sections

Use `<Card>` when:
- The data is grouped and benefits from a labelled enclosure (Daily plan,
  Automation panel, Approval pack).
- The section has its own toolbar.

Don't use `<Card>` when:
- It's a primary table or list — let the page own the surface.
- You'd end up with a card containing a single table with no other chrome.
- You're nesting cards. Never nest cards. Use a `Separator` instead.

---

## 6. Tabs vs accordions vs split routes

| Use… | When |
|---|---|
| **Tabs** | 2–6 peer views of the same subject (Dashboard tabs, Capability detail). User switches frequently. |
| **Accordions** | Optional panels glanceable on one page (Roadmap settings, Evidence sub-sections). User expands occasionally. |
| **Split routes** | Distinct concerns that deserve their own URL and sidebar entry (Admin settings vs Roadmap config). User navigates rarely between them. |

Avoid: a page that is *both* tabs and large accordions. Pick one axis of
organisation per page.

---

## 7. Tables and lists

- Default density: `text-xs`, `h-8` rows, `h-8` headers.
- Header: `text-muted-foreground font-medium uppercase tracking-wide text-[10px]`.
- Use `divide-y divide-border/60` instead of cell borders.
- Right-align numerics with `tabular-nums`.
- Empty state: one line, `text-muted-foreground p-3`. No illustrations.
- Pagination > infinite scroll for operator tables (you need to find rows again).

---

## 8. Tints (semantic colours)

Seven tokens, one meaning each. Use the **semantic** name, never raw hex or
`text-violet-500`.

| Token | Hue | Used for |
|---|---|---|
| `tint-night` | violet | Night Agent, after-hours, observation-only surfaces |
| `tint-event` | slate | Neutral activity, event ticker, generic "something happened" |
| `tint-approval` | amber | Pending operator action, approval queue |
| `tint-discussion` | blue | Discussion actions, copilot collaboration |
| `tint-capability` | emerald | Capability registry, promotions, manifest events |
| `tint-risk` | red | Risk, failures, critical findings |
| `tint-okr` | sky | OKRs, roadmap |

### Allowed usages

```tsx
// Status dot
<span className="h-1.5 w-1.5 rounded-full bg-tint-approval" />

// Inline badge / chip
<span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]
                 font-medium bg-tint-night/15 text-tint-night">
  Night
</span>

// Left-border accent on a row
<li className="border-l-2 border-tint-discussion pl-2">…</li>

// Icon tint
<Bell className="h-3.5 w-3.5 text-tint-approval" />
```

### Disallowed usages

- ❌ `bg-tint-night` as the primary background of a card or pane.
- ❌ `text-tint-okr` for body copy.
- ❌ Two tints on the same element (pick one signal).
- ❌ `text-tint-night-foreground` outside of a solid `bg-tint-night` fill (which
  itself is a rare case — a single solid pill, never a panel).

The `-foreground` variants exist for that one rare case (a solid pill). Day to
day you only need the base token.

### Source-of-truth mapping

Anywhere that surfaces "what is this?" should pick from the table above. The
operator panes, sidebar dots, dashboard widget chips, and CHANGELOG categories
all draw from the same well.

---

## 9. Iconography

- Lucide only. No emoji in chrome (emoji in user-generated content is fine).
- Inline / row icon: `h-3.5 w-3.5`.
- Button icon: `h-4 w-4`.
- Big illustrative icon: `h-5 w-5` max. We don't do hero icons.
- Icon colour follows text — almost never an explicit `text-*` class. The
  exceptions are tint accents (see §8) and status dots.

---

## 10. Operator pane sources

Each pluggable pane source ships with its canonical tint, listed here so the
sidebar dot, the pane header, and any badge stay consistent.

| Source | Tint | Default route |
|---|---|---|
| Night Agent | `tint-night` | `/night` |
| Event ticker | `tint-event` | `/events` |
| Pending approvals | `tint-approval` | `/approvals` |
| Discussion actions | `tint-discussion` | `/jobs` |

See [docs/operator-panes.md](./operator-panes.md) for the picker, persistence
model, and per-route defaults.

---

## 11. Worked example — `/jobs` page header

Today the Jobs page uses ad-hoc padding and a heavier title. Against this guide:

```tsx
<main className="mx-auto w-full max-w-7xl px-4 py-4 space-y-6">
  <header className="flex items-start justify-between gap-4">
    <div className="space-y-1">
      <h1 className="text-xl font-semibold leading-none">Jobs board</h1>
      <p className="text-sm text-muted-foreground">
        Open discussion actions across copilots.
      </p>
    </div>
    <div className="flex items-center gap-2">
      <FilterChips />
      <Button size="sm">New job</Button>
    </div>
  </header>

  <section className="space-y-3">
    {/* table at full container width, no surrounding card */}
    <JobsTable />
  </section>
</main>
```

Three concrete deltas vs current pages:
1. Container is `py-4` not `py-12`.
2. Title is `text-xl`, not the `text-3xl` some pages use.
3. The table is bare, not wrapped in a `<Card>` it doesn't need.

Use this shape when refactoring Roadmap, Admin, and Control Plane next.

---

## 12. AWIP brand layer (v2 spec — opt-in)

The brand doc (`AWIP_Implementation_Design_System_v2.docx`) is **principles +
brand reference**, not a replacement for §§1–11. The current operator design is
the **default**; nothing below changes existing tokens, classes, or screenshots.
Apply v2 piece by piece, behind explicit opt-in.

### 12.1 Brand identity

| Role | Value | Token (opt-in) | Where |
|---|---|---|---|
| Background (dark surfaces) | `#071426` Deep Midnight | (existing `--background` in `.dark`) | Operator chrome |
| Primary action | `#2D7FF9` Operational Blue | `--brand-primary` | Marketing CTAs, future operator primary |
| Insight accent | `#F5B942` Gold | `--tint-insight` | Intelligence highlights, sparingly |
| Body type | IBM Plex Sans | n/a yet | Marketing first, operator later |

Gold is **never** a primary action. Blue is the CTA; gold marks insight.

### 12.2 Tint rename — alias only, no migration

v2 proposes renamed tints. We **keep the current seven canonical** and add
aliases. Both names resolve to the same HSL until/unless a deliberate rename
PR lands.

| v2 name | Maps to (canonical) | Notes |
|---|---|---|
| `tint-alert` | `tint-risk` | rename only |
| `tint-review` | `tint-approval` | rename only |
| `tint-action` | `tint-capability` | semantic shift; review before adopting |
| `tint-focus` | `tint-discussion` | semantic shift; review before adopting |
| `tint-insight` | **new** (`#F5B942`) | no existing token; added as opt-in |
| `tint-event` | `tint-event` | retained as-is |
| `tint-night` | `tint-night` | retained as-is |
| `tint-okr` | `tint-okr` | **retained** — v2 dropped it; we keep it (load-bearing) |

No file should rename `tint-approval → tint-review` etc. without a dedicated
migration PR + visual-regression sweep. New code may use `tint-insight` freely.

### 12.3 Two type scales

| Scale | Where | H1 | Body | Status |
|---|---|---|---|---|
| **operator** (canonical) | `/jobs`, `/morning-review`, `/admin/*`, all consoles | `text-xl font-semibold` | `text-sm` | Default — do not change |
| **marketing** (v2) | `/`, `/auth`, future landing, printable reports | `text-4xl/5xl` IBM Plex Sans | `text-base` | Opt-in per route |

Never apply the marketing scale to an operator page — information density breaks.

### 12.4 Button heights

| Token | Height | Where |
|---|---|---|
| `button-dense` (canonical) | `h-7` / `h-8` | Operator toolbars, tables — current default |
| `button-touch` (v2) | 44px | Mobile companion, marketing CTAs only |

### 12.5 HSL token map (reference)

Hex from the v2 doc, converted to HSL for `index.css`. Only `--brand-primary`
and `--tint-insight` are added in this PR — the rest are reference values for a
future migration, not applied.

```
--background (dark)   222 70% 9%    /* #071426  — matches existing tone */
--brand-primary       216 94% 58%   /* #2D7FF9  — added, opt-in */
--tint-insight        40  90% 61%   /* #F5B942  — added, opt-in */
--tint-capability v2  158 70% 50%   /* #31C48D  — reference only */
--tint-approval v2    38  92% 50%   /* #F59E0B  — reference only */
--tint-risk v2        0   85% 60%   /* #EF4444  — reference only */
--tint-discussion v2  216 94% 58%   /* #2D7FF9  — reference only */
```

