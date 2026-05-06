# Architecture Decision Records

Each ADR captures one decision: the context, the decision, and the consequences. One page each. Numbered sequentially.

## Lifecycle

- `proposed` — drafted, under discussion
- `accepted` — in force; code reflects it
- `superseded` — replaced; link to the successor in the front-matter

Never delete an ADR. Supersede it.

## Convention

- Filename: `NNNN-kebab-title.md` starting from `0001`
- Copy `_template.md` to start a new one
- Keep it under one page. If it sprawls, the decision is too big — split it.

## Standing review: Ruflo

We periodically scan [ruvnet/ruflo](https://github.com/ruvnet/ruflo) for patterns worth borrowing. The default answer is **no**, unless a concrete AWIP pain matches a Ruflo pattern. Every time we consider one, log an ADR — accepted or rejected with reason — so future contributors don't churn on the same questions.

**Considered, deferred** (as of v1):
- Hooks framework — not enough surface area yet
- Swarm / agent-spawning runtime — wrong abstraction for OKR substrate
- Plugin marketplace as delivery mechanism — N=1 module project
- Signed witness manifests — overkill before second module
- Tiered embedding fallback — no embedding layer yet

**Adopted** (see ADRs):
- ADR-style decision log itself (this folder)
- Redaction of secrets in logs and event payloads
- `resolution_warning` events for unowned/unknown capability demand
