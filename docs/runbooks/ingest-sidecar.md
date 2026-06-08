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
    { "chunk_index": 0, "content": "markdown…", "tokens": 480, "metadata": { "page": 1 } }
  ]
}
```

Headers:
- `Content-Type: application/json`
- `x-approval-signature: <hex hmac-sha256 of body using APPROVAL_CALLBACK_SECRET>`

## Sizing & chunking rules

- Chunk size: aim 1500 chars, max 20000 (validator hard-limit).
- Split on heading boundaries first, then paragraph, then sentence.
- Include `metadata.page`, `metadata.section`, `metadata.sheet` (XLSX) when known.
- Max 2000 chunks per file — split into multiple `file_id`s upstream if larger.

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
