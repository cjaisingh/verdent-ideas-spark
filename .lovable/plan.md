## Goal
Polish the print output of `src/pages/ApprovalPack.tsx` so the generated PDF (via `window.print()`) looks like a proper document: branded headers/footers on every page, page numbers, and a consistent table-style checklist for each task.

## Scope
Frontend-only changes to `src/pages/ApprovalPack.tsx`. No DB, route, or business logic changes.

## Changes

### 1. Page headers & footers (CSS `@page`)
- Use `@page` margin boxes to render a fixed header and footer on every printed page:
  - Top-left: "AWIP — Approval Pack"
  - Top-right: phase key + title (passed in via a CSS custom property set at print time)
  - Bottom-left: generation timestamp
  - Bottom-right: page number — `counter(page) " / " counter(pages)`
- Add a thin border-bottom on the header box and border-top on the footer for separation.
- Set `@page { size: A4; margin: 2cm 1.5cm; }`.

### 2. Pagination behaviour
- Force a page break before each phase summary card and before each Sprint card after the first (`break-before: page` on `.pp-sprint + .pp-sprint`, or explicit `.page-break` helper).
- `break-inside: avoid` on each task block and each checklist row so a task isn't split mid-row.
- `orphans: 3; widows: 3;` on text blocks.
- Repeat checklist table headers across pages using `<thead>` (browsers honor `display: table-header-group` for repeated headers in print).

### 3. Consistent checklist table per task
- Replace the current ad-hoc `<div>` list of checklist items with a real `<table class="pp-checklist">` per task using the existing `@/components/ui/table` primitives (or a plain semantic table for cleaner print rendering).
- Columns:
  1. Status — `[x]` / `[ ]` (monospace, ~24px)
  2. Category — small uppercase badge-style cell
  3. Item — checklist label, with note on a second line in muted italic
  4. Evidence — stacked links/file refs (title + source)
  5. Reviewer — `checked_by` initials/name
- Zebra striping on print (`tbody tr:nth-child(even) { background: #f7f7f8; }` with `print-color-adjust: exact`).
- Task evidence (items with no `checklist_item`) stays as a small "Task evidence" sub-table with the same column rhythm.

### 4. Print-only refinements
- Force light colors in print (override card/badge tokens to black-on-white) and add `print-color-adjust: exact` so the zebra rows and badge outlines render.
- Hide on-screen-only chrome already covered by `print:hidden`; additionally hide the toaster, sidebar trigger, and any sticky elements.
- Use `font-size: 10.5pt` for body and `9pt` for table cells to fit more content per page.
- Anchor links print as plain text + URL in parentheses (`a[href]::after { content: " (" attr(href) ")"; }`) — but only for external evidence URLs (scoped via a class, not all links).

### 5. Implementation details
- Set the phase title as a CSS variable on `<html>` (or `document.documentElement.style.setProperty('--pp-phase', '"PHASE — TITLE"')`) right before calling `window.print()`, then clear it after `afterprint`. Used by `@top-right { content: var(--pp-phase); }`.
- Keep all print CSS in the existing inline `<style>` block at the bottom of the file; no new files needed.
- Keep the on-screen layout essentially as-is so the editor view is unchanged.

## Out of scope
- Server-side PDF generation (still uses browser print).
- Adding new data fields or DB columns.
- Markdown export changes.
