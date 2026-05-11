---
name: ontology
description: Canonical entities, lifecycles, and authority sources for AWIP Core. Source of truth is docs/ontology.md, surfaced at /ontology.
type: feature
---

11 entities locked W1.1: task, finding, lesson, approval, event, discussion, workflow, roadmap item, sign-off, action, review.

Each entry has 6 fields: ownership, lifecycle, mutation rules, authority source, audit, relationships.

**Source of truth:** `docs/ontology.md` (markdown, git-versioned).
**Surface:** `/ontology` page imports the file via `?raw` and renders it (no DB table, no editing UI).
**Sidebar:** Knowledge group → "Ontology" (BookOpen icon, between Memory and Lessons Loop).

**How to update:** edit `docs/ontology.md`, append a CHANGELOG entry inside the doc, update CHANGELOG.md, mention in next Morning Review. Do NOT add an editing UI — the doc is governance-grade and changes must go through git.

**Layer assignment preview** (enforced in W1.2): the doc lists which tables are evidence (immutable), interpretation, or narrative. Narrative writers must never UPDATE/DELETE evidence rows.
