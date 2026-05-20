
## Doc-drift audit results

Ran `scripts/check-doc-drift.ts` at two windows.

**Last 5 commits — 3 real gaps:**
- 4 migrations (20260520084200 / 084444 / 084700 / 090754) shipped without named CHANGELOG entries
- 3 pages touched without docs file co-edit: `AdminAiUsage`, `OperatorInbox`, `Postmortems`

**Last 20 commits — 11 page-drift errors.** Mostly old; not worth back-filling.

**Content check:** CHANGELOG `[Unreleased]` already describes *what* those migrations and pages do (BalanceTrackingPanel, Unified Operator Inbox, Auto-postmortem). The drift script trips on file-touch heuristic, not missing prose. Inbox doc has no mention of Caprica image-blind behaviour — that's a genuine gap.

**File size hygiene:** all `mem/features/*.md` within 30-line cap. `docs/operator-inbox.md` at 59 / 200 lines (fine). `mem/index.md` at 77 lines — getting busy but legal.

---

## Proposed fixes (small, in-scope)

1. **Inspect the 4 unattributed migrations** — read them, confirm they belong to one of the existing `[Unreleased]` bullets, and add a one-line "Migrations:" suffix to the relevant bullet so the heuristic stops complaining.
2. **`docs/operator-inbox.md`** — add a short "Known gap: image messages" section noting Caprica photo file_ids land in `raw->'message'->'photo'` but are not OCR'd / vision-described, so they currently render as empty rows. Link to the deferred vision-branch work.
3. **No changes** to AdminAiUsage / Postmortems doc trail — content already covered in CHANGELOG, would be busywork.
4. **No back-fill** of the older 8 page-drift errors. They're behind us; doc-drift gate only runs on PR diffs against `main`, so they don't block anything.

Skipping: `mem/index.md` entry for "Caprica lane is image-blind" — would be a transient state note, violates `mem://preferences/doc-hygiene`. Keep it in the operator-inbox doc only.

## Out of scope
- The vision branch itself (deferred per your previous turn).
- Operator Inbox image thumbnail rendering.
- Lint baseline drain.

If you want, I can also expand `scripts/check-doc-drift.ts` to look inside CHANGELOG `[Unreleased]` for migration filenames, so future "migration without CHANGELOG entry" warnings only fire when the prose is actually missing — but that's a tooling change, separate ticket.

Approve and I'll do (1) + (2) only.
