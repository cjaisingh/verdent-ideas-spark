## Goal

Write a short, opinionated design guide and add the supporting design tokens (including a small set of semantic "tints") so subsequent refactors — Roadmap cleanup, Admin tabs, Control Plane, and the new pluggable panes — all align to one yardstick.

This plan ships **the guide + tokens only**. No page refactors. The pane-sources plan (already approved) runs after.

## Deliverables

### 1. `docs/design-system.md` (new)

Short, scannable, ~400 lines max. Sections:

1. **Principles** — monochrome by default, tints are signals not decoration, density over padding, one active treatment per surface.
2. **Page layout** — canonical container: `mx-auto w-full max-w-7xl px-4 py-4` (not `py-12`). When to use full-bleed.
3. **Page header pattern** — title + optional subtitle + actions row, fixed height, examples.
4. **Section spacing scale** — `space-y-3` inside cards, `space-y-6` between page sections. No ad-hoc `mt-12`.
5. **Cards vs bare sections** — when to use `<Card>` (grouped data), when not (pure lists, tables).
6. **Tabs vs accordions vs split routes** — decision rules (used by Admin, Roadmap).
7. **Tables & lists** — density: `text-xs` rows, `h-8` headers, zebra optional.
8. **Tints (semantic colors)** — see below. Usage rules: badges, dots, left borders, subtle backgrounds at 10–15% alpha. Never as primary surface fill.
9. **Iconography** — lucide only, `h-3.5 w-3.5` inline, `h-4 w-4` for buttons.
10. **Operator pane sources** — pointer to `docs/operator-panes.md`; lists the canonical tint per source.

### 2. Token additions in `src/index.css` and `tailwind.config.ts`

Add a small **tint scale** as HSL CSS vars, both light and dark, exposed as Tailwind colors. These are the "subtle signal" colors used across status dots, badges, pane source headers, and category accents.

```
--tint-night        (violet)   — Night Agent, after-hours
--tint-event        (slate)    — neutral activity / event ticker
--tint-approval     (amber)    — needs operator action
--tint-discussion   (blue)     — collaboration / discussion actions
--tint-capability   (emerald)  — capability registry / promotions
--tint-risk         (red)      — risk / failures (re-skin of destructive)
--tint-okr          (sky)      — OKRs / roadmap
```

Each gets a foreground variant (`--tint-night-foreground`, etc.) sized for `text-on-tint` usage. Tailwind config exposes them as `tint-night`, `tint-night-foreground`, … so components use semantic names, never raw hex.

Light + dark values are tuned for AA contrast on `bg-muted/40` backgrounds (the dominant pane background).

### 3. Token additions: spacing primitives

Short list, no new utilities — just documents the canonical Tailwind classes already in the codebase so reviewers can point at the guide:

- Page container: `mx-auto w-full max-w-7xl px-4 py-4`
- Section gap: `space-y-6`
- Card inner gap: `space-y-3`
- Header height: `h-12` (page), `h-9` (pane), `h-8` (table)

No new Tailwind plugin; this lives in the doc.

### 4. Worked example

One worked example in the doc — convert `/jobs` page header conceptually (text only, no code change) — so the next refactor PRs have something concrete to copy.

## Out of scope (next plans)

- Refactoring Roadmap / Jobs / Admin / ControlPlane against the guide.
- Pluggable panes (already approved, runs after this).
- Replacing existing ad-hoc colors throughout the app (will happen incrementally).

## Files

**New:**
- `docs/design-system.md`

**Edited:**
- `src/index.css` — add `--tint-*` vars (light + dark) under `:root` and `.dark`
- `tailwind.config.ts` — extend `colors` with `tint: { night, event, approval, discussion, capability, risk, okr }` and matching `*-foreground`
- `README.md` — add link to the design guide under "Docs"
- `CHANGELOG.md` — entry under Unreleased

## Validation

- New tint classes resolve in dev (e.g. `bg-tint-night/15 text-tint-night-foreground` renders with no missing-class warning).
- Light and dark mode show readable contrast on `bg-background` and `bg-muted/40`.
- Doc renders cleanly on GitHub (no broken anchors, fenced code blocks valid).
- No existing component visually changes — this is additive.

## After this lands

The pane-sources plan picks up unchanged, but each new source uses its canonical tint from the guide:
- Night Agent → `tint-night`
- Event ticker → `tint-event`
- Approvals → `tint-approval`
- Discussion actions → `tint-discussion`
