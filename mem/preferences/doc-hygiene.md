---
name: Doc hygiene
description: Caps and rules to keep .md files lean reference, not session narrative or token bloat
type: preference
---

# Doc hygiene

`.md` files are **reference**, not narrative. No session recaps, no "what we did today", no changelog-in-prose.

## Hard caps
- `mem/**` entries: ≤ 30 lines. Over cap → split or prune.
- `docs/**` feature docs: ≤ 200 lines. Over cap → split into sub-docs or prune stale sections.
- `mem/index.md` entries: one line, ≤ 150 chars.
- `CHANGELOG.md` entries: one line each. Release prose goes in `src/content/release-notes/`.

## Rules
- Before editing any `.md`, check `wc -l`. If near cap, prune stale content in the same edit.
- Prefer linking to existing docs over restating.
- Never add session-specific recaps to `docs/**` or `mem/**` — those belong in chat or release notes.
- When a memory describes a transient state ("fixed today", "in progress"), refactor to the durable rule or delete.
