# Deep-think prompts

Run these against the draft plan. Each prompt that surfaces a real answer becomes a paragraph in the plan's "Alternatives considered" section.

## Assumption surfacing

- What am I assuming is true that I haven't verified? (Run `supabase--read_query` or `code--view` to check.)
- What part of the user's request did I paraphrase? Re-read the literal words.
- Which Core rule (`CONTEXT.md`) am I closest to bending? If bending, is the rule wrong or the plan wrong? (Almost always the latter.)
- Which FM-AI failure mode (`docs/why-awip.md`) does this defuse? If none, why are we building it?

## Failure modes

- What is the cheapest way for this to be wrong?
- What breaks at 100× the expected scale? At 0?
- What happens if the cron fires twice? If the edge fn 504s mid-write? If the operator double-clicks?
- What's the rollback story if this ships and breaks production?
- Who else writes to the same table / channel / surface? Will their writes still work?

## Persona pre-mortem

- What would **product-historian** reject for narrative drift?
- What would **event-engineer** reject for a missing `*_events` row?
- What would **tenant-manager** reject for an RLS hole?
- What would **sentinel** notice 15 minutes after deploy?

## Alternatives table

Before picking, fill in at least two rows:

| Option | Cost | Risk | Reversibility | Why discarded / chosen |
| --- | --- | --- | --- | --- |
| A (chosen) | … | … | … | chosen because … |
| B | … | … | … | discarded because … |

If you can only think of one option, you haven't thought enough. The "do nothing" / "defer to next sprint" option counts and is often correct.

## Output

Three bullets into the plan:
1. Top 1–2 assumptions verified (with the query / file you checked).
2. Top 1–2 failure modes defused (with the mechanism — trigger, idempotency, sentinel check).
3. The alternatives table.
