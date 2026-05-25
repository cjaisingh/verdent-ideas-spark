# Flow Ontology (stub)

> **Status:** placeholder. Intent recorded so it isn't lost. No schema, no `/ontology` surface change until a domain module needs it.

## Why this exists

`docs/ontology.md` defines AWIP's 12 canonical **entities** (the nouns). Klarity's wedge is that they also model the canonical **flows** (the verbs that move work between nouns): Quote-to-Cash, Hire-to-Retire, Idea-to-Ship. Without a flow layer, AWIP can record state changes but can't answer "where in the operator's day did this break?" or "which flow does this finding belong to?"

This file is the parking spot. Promote to a real ontology layer only when a domain module produces a flow that doesn't fit cleanly into the existing entity graph.

## Candidate flows (TODO — do not implement)

1. **operator-day** — wake → Morning Review → triage → focus blocks → tomorrow plan → sleep.
2. **phase-loop** — propose → plan → tasks → overnight run → sign-off gates → shipped.
3. **night-shift** — eligibility → claim → execute → audit → close (or `auto_blocked`).
4. **morning-review** — sentinel tick → aggregator → panels → triage chips → mirror action.
5. **audit-cycle** — schedule → deep audit → findings → lessons promotion → release notes.
6. **quarterly-review** — open action → docs draft → operator sign-off → published.

Each would carry: `name`, `entry_event`, `terminal_events[]`, `expected_duration`, `owning_module`, `failure_modes[]`. None of this is built.

## When to promote this

Trigger condition: a Phase 6 (Ingest & Canonicalisation) source produces a record whose meaning depends on knowing *which flow* it belongs to, not just which entity. Until then, leave as stub.

## Related

- `docs/ontology.md` — entity layer (locked W1.1)
- ADR-0003 — OKR-driven execution (the closest existing "flow" framing)
- `mem://features/ontology` — entity rules
