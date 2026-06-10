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
  "doc_embedding": [0.123, -0.456, ...],
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
  ]
}
```

`doc_embedding` is a 1536-float array, mean-pooled from all chunk embeddings and normalised to a unit vector. See Step 4 of the Semantic indexing pipeline below.

Headers:
- `Content-Type: application/json`
- `x-approval-signature: sha256=<hex hmac-sha256 of body using APPROVAL_CALLBACK_SECRET>` (note: include the `sha256=` prefix)

## Semantic indexing pipeline

The sidecar runs five sequential steps for every file before posting to ingest-callback.

### Step 1 — Semantic chunking

Replaces the old fixed-size chunking strategy.

1. Run markitdown on the file to get a markdown string.
2. Split on heading boundaries (H1 / H2 / H3) to produce sections.
3. Within each section, split further on paragraph boundaries (`\n\n`).
4. If a paragraph exceeds 1500 chars, split on the nearest sentence boundary (`.`, `!`, `?`) before that limit.
5. Hard max: 20000 chars per chunk (validator limit). Any chunk exceeding this must be split regardless of sentence boundaries.
6. Assign hierarchy metadata:
   - The **first chunk** in a section: `is_section_root=true`, `section_id=<heading path>` (e.g. `"3.2.1 HVAC"`), `parent_chunk_index=null`.
   - **Subsequent chunks** in the same section: `is_section_root=false`, `section_id=<same heading path>`, `parent_chunk_index=<chunk_index of the section's first chunk>`.
7. Chunks that fall before any heading use `section_id=null`, `is_section_root=false`, `parent_chunk_index=null`.

### Step 2 — Chunk type classification

Classify each chunk into exactly one of the following types using keyword heuristics (fast, no LLM call required):

| Type | Keywords (case-insensitive) |
|---|---|
| `maintenance_record` | "work order", "PPM", "corrective", "reactive", "inspection date", "engineer" |
| `asset_spec` | "rated", "capacity", "model no", "serial", "manufacturer", "kW", "m²", "install" |
| `compliance_clause` | "shall", "must", "regulation", "standard", "BS EN", "CIBSE", "SFG20", "compliance" |
| `inspection_note` | "observed", "noted", "finding", "condition", "defect", "recommendation" |
| `procedure` | "step 1", "procedure", "method statement", "RAMS", "sequence" |
| `general` | _(default — none of the above matched)_ |

Apply heuristics in the order listed; use the first match. If multiple keywords from different types appear, the first matching type wins.

### Step 3 — Entity extraction

For each chunk, scan for known entity aliases from the AWIP entities registry and populate `entity_refs` with matched entity UUIDs.

**Fetching the alias registry:**

```
GET {SUPABASE_URL}/functions/v1/awip-api/ontology/entities?format=aliases
x-awip-service-token: <AWIP_SERVICE_TOKEN>
```

The response is a map of `{ [uuid]: string[] }` where each value is the list of aliases for that entity.

**Matching rules:**
- Case-insensitive.
- Whole-word match only (do not match partial words inside a longer token).
- A single chunk may reference multiple entities; collect all matched UUIDs into `entity_refs`.

**Degraded mode:** If the registry endpoint is unavailable or returns an error, send `entity_refs=[]` for all chunks. Do not fail the whole parse job.

### Step 4 — Compute doc_embedding

After all chunk embeddings have been generated (either locally or received from AWIP's embedding service):

1. Stack all chunk embedding vectors into a matrix of shape `[num_chunks, 1536]`.
2. Compute the element-wise mean across the chunk axis: `doc_embedding[i] = mean(chunk_embedding[c][i] for c in chunks)`.
3. Normalise the resulting vector to unit length (L2 norm = 1.0).
4. Include as `doc_embedding` in the top-level callback body.

### Step 5 — Callback

POST the full enriched body to `ingest-callback`:

- Include `doc_embedding` and the enriched `chunks` array (with `chunk_type`, `section_id`, `is_section_root`, `parent_chunk_index`, `entity_refs`).
- Set `x-approval-signature: sha256=<hex hmac>` — the `sha256=` prefix is required; the HMAC is computed over the raw request body bytes using `APPROVAL_CALLBACK_SECRET`.

## Sizing & chunking rules

- Chunk size target: 1500 chars; hard max: 20000 chars (validator limit). See Step 1 of the Semantic indexing pipeline for the full split strategy.
- Split on heading boundaries first, then paragraph, then sentence (replaces the old fixed-size approach).
- Include `metadata.page`, `metadata.section`, `metadata.sheet` (XLSX) when known.
- Max 2000 chunks per file — split into multiple `file_id`s upstream if larger.

## Heartbeat

Optional `POST` to `ingest-callback` with `status="parsing"` and an empty `chunks` array every 5 min for long parses; Core uses `last_heartbeat_at` to detect stuck jobs.

## Deploy target

Anything that runs a Python container with HTTP egress: Cloud Run, Fly, Render, Railway. Decision deferred — tracked as a separate discussion_action.

## Local testing

```bash
# Compute HMAC with the sha256= prefix:
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$APPROVAL_CALLBACK_SECRET" | awk '{print $2}')"

curl -X POST "$SUPABASE_URL/functions/v1/ingest-callback" \
  -H "Content-Type: application/json" \
  -H "x-approval-signature: $SIG" \
  -d "$BODY"
```
