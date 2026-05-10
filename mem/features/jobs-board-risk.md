---
name: jobs-board-risk
description: Risk dimension on discussion_actions gates Night Agent eligibility — critical never night, high needs override reason.
type: feature
---
**Field:** `discussion_actions.risk` enum-as-text `low | med | high | critical`, default `med`. Separate from `priority` (priority = when, risk = blast radius if wrong).

**Gate:** trigger `enforce_night_eligibility_by_risk` runs BEFORE INSERT/UPDATE:
- `risk='critical'` → forces `night_eligible=false`, clears `night_override_reason`. Hard no.
- `risk='high'` → `night_eligible=false` unless `night_override_reason` is non-empty.
- `low`/`med` → no gate; override reason auto-cleared.

**Audit:** `discussion_action_events.event_type` adds `risk_changed` and `night_override`.

**Rubric (tooltip + `docs/jobs-board.md`):**
- critical: auth, billing, RLS, irreversible migrations
- high: schema, edge-function contracts, customer-visible UX
- med: internal pages, copy, non-destructive refactors
- low: pure docs, comments, lint, semver-patch deps

**UI:** colored risk dot + risk badge in Jobs page card, Discussion Actions pane row, and JobDetailsDrawer. Drawer has a Risk & night-shift editor with risk select, override-reason textarea (visible when `risk=high`), and a moon toggle that disables when blocked.

**Backfill:** every existing row → `med`. Operator re-tiers as encountered.
