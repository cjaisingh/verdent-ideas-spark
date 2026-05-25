# Phase 6 rediscovery audit

_Not yet run. Generate with:_

```bash
deno run -A scripts/audit-rediscovery.ts
```

Mines `ai_usage_log` (last 30d) for rediscovery hot-spots and ranks them against `public.retrieval_contracts`. Output overwrites this file. Pair the top entries with their declared shape — those surfaces are where building the matching store first will pay back fastest.

See:

- `scripts/audit-rediscovery.ts` — source
- `mem://preferences/retrieval-shapes` — why this matters
- `mem://features/retrieval-contracts-registry` — the declaration table this report joins against
