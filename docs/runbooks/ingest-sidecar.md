# Markitdown ingest sidecar — runbook

Out-of-repo Python container that parses client files into markdown and posts chunks back to AWIP Core's `ingest-callback`.

## Why a sidecar

`markitdown` is Python (CPython). Deno edge functions can't run it. We need a long-running process that can also keep heavy parsing deps (pandoc, libreoffice, tesseract, ffmpeg) hot.

## Contract

Inputs from Core:
- `file_id` (uuid)
- signed download URL for the storage object
- `parser_version` Core expects (sidecar echoes it back)

Output to `POST {SUPABASE_URL}/functions/v1/ingest-callback`:
```json
{
  "file_id": "uuid",
  "parser": "markitdown",
  "parser_version": "0.1.x",
  "status": "parsed" | "metadata_only" | "failed",
  "failure_reason": null,
  "chunks": [
    {
      "chunk_index": 0,
      "content": "markdown…",
      "tokens": 480,
      "chunk_type": "maintenance_record",
      "section_id": "3.2 Mechanical Systems",
      "is_section_root": false,
      "parent_chunk_index": null,
      "entity_refs": ["uuid1", "uuid2"],
      "metadata": { "page": 1 }
    }
  ],
  "doc_embedding": [0.123, -0.456, "... 1536 floats, mean-pooled + unit-normalised from chunk embeddings"]
}
```

Headers:
- `Content-Type: application/json`
- `x-approval-signature: sha256=<hex hmac-sha256 of body using APPROVAL_CALLBACK_SECRET>`

  The signature MUST include the `sha256=` prefix. The callback now accepts both the prefixed and bare forms, but the sidecar should always send the prefixed form.

## Sizing & chunking rules

- Chunking is semantic, not fixed-size — see Step 1 of the semantic indexing pipeline below. Sections are derived from heading boundaries; paragraphs (and sentences for paragraphs over 1500 chars) form chunks within a section.
- Hard cap 20000 chars/chunk (validator hard-limit).
- Include `metadata.page`, `metadata.section`, `metadata.sheet` (XLSX) when known.
- Max 2000 chunks per file — split into multiple `file_id`s upstream if larger.

## Semantic indexing pipeline (W9.1)

The sidecar runs these 5 steps to produce the enriched callback body above.

### Step 1 — Semantic chunking (replaces fixed-size)

Split on heading boundaries (H1/H2/H3 emitted by markitdown) into sections. Within each section, split on paragraph, then on sentence if a paragraph exceeds 1500 chars. Hard cap 20000 chars/chunk.

- The first chunk of each section: `is_section_root=true`, `section_id="<heading path e.g. 3.2.1 HVAC>"`, `parent_chunk_index=null`.
- Subsequent chunks in the same section: `is_section_root=false`, same `section_id`, `parent_chunk_index` = the index of that section's root chunk.

### Step 2 — Chunk type classification

Classify each chunk into exactly one of: `maintenance_record`, `asset_spec`, `compliance_clause`, `inspection_note`, `procedure`, `general`. Use keyword heuristics first (no LLM call). First matching type wins; fall back to `general`.

| chunk_type | keyword cues |
|---|---|
| maintenance_record | "work order", "PPM", "corrective", "reactive", "engineer", "inspection date" |
| asset_spec | "rated", "capacity", "model no", "serial", "manufacturer", "kW", "m²" |
| compliance_clause | "shall", "must", "regulation", "BS EN", "CIBSE", "SFG20", "compliance" |
| inspection_note | "observed", "noted", "finding", "condition", "defect", "recommendation" |
| procedure | "step 1", "method statement", "RAMS", "sequence" |
| general | (default — no keyword match) |

### Step 3 — Entity extraction

For each chunk, match against known entity aliases from the AWIP ontology registry. Fetch the alias set once per job via:

```
GET {SUPABASE_URL}/functions/v1/awip-api/ontology/entities?format=aliases
```

with header `x-awip-service-token`. Do a case-insensitive whole-word match of aliases against chunk content and populate `entity_refs` with the matched entity UUIDs. If the registry is unavailable, send `entity_refs: []` (degraded mode — do not fail the callback).

### Step 4 — Compute doc_embedding

Mean-pool all chunk embeddings, then unit-normalise the result. Send it as the top-level `doc_embedding` field (1536 floats).

### Step 5 — Callback

POST the enriched chunks plus `doc_embedding` to `ingest-callback`, signed with the `sha256=`-prefixed HMAC header (see Headers above).

## Heartbeat

Optional `POST` to `ingest-callback` with `status="parsing"` and an empty `chunks` array every 5 min for long parses; Core uses `last_heartbeat_at` to detect stuck jobs.

## Deploy target

Anything that runs a Python container with HTTP egress: Cloud Run, Fly, Render, Railway. Decision deferred — tracked as a separate discussion_action.

## Local testing

```bash
curl -X POST "$SUPABASE_URL/functions/v1/ingest-callback" \
  -H "Content-Type: application/json" \
  -H "x-approval-signature: $(echo -n "$BODY" | openssl dgst -sha256 -hmac "$APPROVAL_CALLBACK_SECRET" | awk '{print $2}')" \
  -d "$BODY"
```
