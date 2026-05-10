# `awip-rag` — knowledge base over project docs

Full-text search over markdown files in this repo, exposed as an edge function. Powers the Companion's "search docs" command and the Copilot "knowledge" surface.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/awip-rag/ingest` | service token only | Upsert docs and rebuild their chunks. Called by `scripts/ingest-awip-docs.ts` (locally or from CI). |
| `POST` | `/awip-rag/search` | operator JWT or service token | Full-text search. Body: `{ q: string, limit?: number (1-20, default 6) }`. Returns ranked chunks. |
| `GET\|POST` | `/awip-rag/scope-map` | operator JWT or service token | Per-agent visibility report: capabilities + tables each Copilot agent is allowed to call, joined with live row counts. Optional `?slug=` filter. |

CORS is enabled for browser callers. Service callers pass `x-awip-service-token: $AWIP_SERVICE_TOKEN`.

## Tables

- **`awip_docs`** — one row per source file. Columns: `path`, `title`, `sha`, `source`, `updated_at`. Unique on `path`.
- **`awip_doc_chunks`** — heading-anchored chunks of each doc (~1.4k chars each), with a `tsv tsvector` column for FTS. Re-created on every `/ingest` for the parent doc.

## Chunking

`supabase/functions/awip-rag/index.ts → chunk()` walks each doc top-to-bottom, flushing on every `#`/`##`/`###` heading. Long sections are hard-split at 1400 chars to keep chunks within the FTS budget.

## Ingest

`scripts/ingest-awip-docs.ts` walks `docs/`, `README.md`, `CHANGELOG.md`, `.lovable/plan.md`, computes a SHA-1 per doc, and POSTs the bundle to `/awip-rag/ingest`. Run after any docs change:

```bash
SUPABASE_URL=https://<project>.supabase.co \
AWIP_SERVICE_TOKEN=<token> \
bun scripts/ingest-awip-docs.ts
```

There is currently **no automated re-ingest** in CI — that's a known gap (raise as a follow-up if doc-driven Copilot answers start lagging).

## Search semantics

`public.awip_rag_search(_q, _limit)` — `SECURITY DEFINER`, gated to `operator|admin`:
1. Builds a `websearch_to_tsquery('english', _q)`.
2. Filters `awip_doc_chunks.tsv @@ query`, ranks by `ts_rank`, joins back to the parent doc.
3. Returns `chunk_id, doc_id, path, title, heading, content, rank`.

The edge function builds a per-user Supabase client when called with an operator JWT so `auth.uid()` resolves inside the RPC's role check (the service-role admin client returns `null` for `auth.uid()` and would fail the gate).

## Callers

- **Frontend:** `src/components/copilot/CopilotKnowledgeCard.tsx`, `src/pages/Companion.tsx` (search box).
- **Service:** none yet. The Rork iPhone companion is expected to use it once knowledge surfaces land in that app.

## Security notes

- `/ingest` requires the service token. The operator JWT path is intentionally rejected to keep ingest a CI/admin operation.
- All searches are gated to `operator|admin` via `has_role()`.
- No row in `awip_docs` is user-owned; visibility is uniform across operators.
