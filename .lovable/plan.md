
## Goal

Three durable rules + one structural fix, so the retro lessons don't evaporate next session.

## 1. Save the retro lessons (memory, not docs)

Append to existing `mem/preferences/verification-discipline.md` (already covers sandbox-vs-not; missing the three new lessons):

- **Read live before planning.** First tool call on any "fix the findings / triage X" request must query the live source (`sentinel_findings`, `automation_runs`, etc.), not summarise cached state.
- **Detector-wrong before system-broken.** When a finding fires, default hypothesis is "the detector is measuring the wrong thing." Cheaper to fix one query than diagnose a phantom outage.
- **Verify-before-scope.** "Stop on first green" needs a matching "start on first real signal" — confirm the finding reflects reality before scoping a fix.

No new file. One file edited. ~15 lines added.

## 2. Doc-hygiene rule (new, small)

New `mem/preferences/doc-hygiene.md`:

- `.md` files are reference, not narrative. No session recaps, no "what we did today", no changelog-in-prose.
- Hard caps: `mem/**` entries ≤ 30 lines; `docs/**` feature docs ≤ 200 lines. Over cap → split or prune.
- CHANGELOG entries one line each. Release notes go in `src/content/release-notes/`, not docs.
- Before editing any `.md`, check line count; if near cap, prune stale sections in the same edit.
- Index (`mem/index.md`) entries one line, ≤ 150 chars (already a rule, restate here).

Add a single line to `mem/index.md` Core: *"Docs are reference, not narrative. Mem ≤30 lines, docs ≤200. Prune in same edit."*

## 3. Test-completed-work rule

New `mem/preferences/verify-completion.md`:

- Definition of done per change type:
  - **Edge function edit** → `supabase--test_edge_functions` for that function (if test exists) OR a `curl_edge_functions` smoke + log check.
  - **Migration** → `supabase--read_query` confirming the new shape + one row insert/select round-trip where applicable.
  - **Detector/sentinel logic** → re-query `sentinel_findings` post-deploy and paste the count.
  - **UI** → console + network check on the affected route via the preview tools.
- "Deployed" ≠ "verified." Never claim done from inference.
- If no automated check is possible, say so explicitly and ask the operator to eyeball.

## 4. Make the 9 agents binding (the real fix)

Today the personas in `docs/agents/team/` only load if I remember to invoke them. Two options — pick one:

**Option A (lightweight, recommended):** Add a triage rule to `mem/index.md` Core that maps request type → required persona to consult before planning. Example:
- contract/API/schema change → `awip-core-rules` + `event-engineer`
- sentinel / triage / findings → `sentinel` + `compliance-auditor`
- new cron/agent loop → `contract-first` checklist + `event-engineer`
- doc/foundation change → `product-historian`
- routing logic in Core → `control-plane-operator` (block)

Three lines in Core, no new files. I cite which persona I consulted in the plan.

**Option B (heavier):** Same mapping but as a checklist file `docs/agents/triage-map.md` referenced from Core. More discoverable for other humans/agents, one extra file.

## What I'm NOT doing

- Not touching live sentinel/data this turn.
- Not creating new agents or personas — the 9 are sufficient, the gap is invocation.
- Not editing any of the 9 persona files themselves.

## Verification when implemented

- `wc -l mem/preferences/{verification-discipline,doc-hygiene,verify-completion}.md` all ≤ 30.
- `mem/index.md` Core gains ≤ 3 lines, total Core still scannable.
- Next session I cite a persona by name in the first plan response touching its domain — if I don't, the rule failed.

## Choice for you

- **A or B** for binding the 9 agents?
- Anything to add/remove from the three lessons in §1?
