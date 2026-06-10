#!/usr/bin/env python3
"""
W9.0 — GHA bulk ingest worker.

Picks up `ingested_files` rows with status='pending' and source='gha-bulk'
(or status='failed' with attempts < 3 + source='gha-bulk' for retry), runs
markitdown locally, and posts chunks back to Core via `ingest-callback`
with an HMAC-signed body.

Required env (GHA secrets):
  SUPABASE_URL                  https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY     service role key (only used here for the
                                bulk worker; never leaves the GHA runner)
  APPROVAL_CALLBACK_SECRET      HMAC key shared with ingest-callback

Optional:
  --max-files N    Hard cap per run (default 50)

Cost note: markitdown is local CPU only. No AI tokens are spent here —
embeddings are generated server-side inside `ingest-callback` (which uses
the cheapest Lovable embedding model). Night-window callbacks land in the
cheap-model band by policy.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

SUPA = os.environ["SUPABASE_URL"].rstrip("/")
SRK = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SECRET = os.environ["APPROVAL_CALLBACK_SECRET"].encode("utf-8")

REST = f"{SUPA}/rest/v1"
FN = f"{SUPA}/functions/v1"
HDR = {
    "apikey": SRK,
    "Authorization": f"Bearer {SRK}",
    "Content-Type": "application/json",
}

MAX_CHUNK_CHARS = 1500
HARD_CHUNK_CHARS = 19_500  # validator hard-limit is 20k


def claim_pending(limit: int) -> list[dict[str, Any]]:
    """Atomically mark pending gha-bulk rows as parsing."""
    # PostgREST doesn't expose UPDATE...RETURNING with row-locking; we do
    # a select then update one-by-one. Concurrency-1 in the workflow keeps
    # this safe.
    r = requests.get(
        f"{REST}/ingested_files",
        headers=HDR,
        params={
            "select": "id,storage_path,filename,mime,size_bytes,attempts,sha256",
            "source": "eq.gha-bulk",
            "status": "in.(pending,failed)",
            "attempts": "lt.3",
            "order": "created_at.asc",
            "limit": str(limit),
        },
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    claimed: list[dict[str, Any]] = []
    for row in rows:
        u = requests.patch(
            f"{REST}/ingested_files",
            headers={**HDR, "Prefer": "return=representation"},
            params={"id": f"eq.{row['id']}", "status": "in.(pending,failed)"},
            data=json.dumps({
                "status": "parsing",
                "parser": "markitdown",
                "last_heartbeat_at": "now()",
                "attempts": (row.get("attempts") or 0) + 1,
            }),
            timeout=30,
        )
        if u.ok and u.json():
            claimed.append({**row, **u.json()[0]})
    return claimed


def download_to_tmp(storage_path: str, filename: str) -> Path:
    # Generate a short-lived signed URL via storage REST.
    bucket = "ingested-files"
    r = requests.post(
        f"{SUPA}/storage/v1/object/sign/{bucket}/{storage_path}",
        headers=HDR,
        json={"expiresIn": 600},
        timeout=30,
    )
    r.raise_for_status()
    signed = r.json()["signedURL"]
    full = f"{SUPA}/storage/v1{signed}"
    out = Path(tempfile.mkdtemp()) / filename
    with requests.get(full, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        with open(out, "wb") as fh:
            for chunk in resp.iter_content(8192):
                fh.write(chunk)
    return out


def chunk_markdown(md: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    buf: list[str] = []
    size = 0
    idx = 0
    for line in md.splitlines(keepends=True):
        if size + len(line) > MAX_CHUNK_CHARS and buf:
            chunks.append({"chunk_index": idx, "content": "".join(buf)[:HARD_CHUNK_CHARS], "metadata": {}})
            idx += 1
            buf = []
            size = 0
        buf.append(line)
        size += len(line)
    if buf:
        chunks.append({"chunk_index": idx, "content": "".join(buf)[:HARD_CHUNK_CHARS], "metadata": {}})
    return chunks[:2000]


def post_callback(payload: dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    r = requests.post(
        f"{FN}/ingest-callback",
        headers={"Content-Type": "application/json", "x-approval-signature": sig},
        data=body,
        timeout=120,
    )
    if not r.ok:
        print(f"  callback FAILED {r.status_code}: {r.text[:500]}", file=sys.stderr)
        r.raise_for_status()


def parse_one(row: dict[str, Any]) -> None:
    fid = row["id"]
    print(f"→ {fid} {row['filename']} ({row.get('size_bytes')}B)")
    try:
        from markitdown import MarkItDown  # type: ignore
    except ImportError:
        post_callback({
            "file_id": fid, "parser": "markitdown", "parser_version": "missing",
            "status": "failed", "failure_reason": "markitdown not installed", "chunks": [],
        })
        return

    try:
        path = download_to_tmp(row["storage_path"], row["filename"])
    except Exception as e:
        post_callback({
            "file_id": fid, "parser": "markitdown", "parser_version": "0.0",
            "status": "failed", "failure_reason": f"download_failed: {e}", "chunks": [],
        })
        return

    md = MarkItDown(enable_plugins=False)
    try:
        res = md.convert(str(path))
        text = (res.text_content or "").strip()
        if not text:
            post_callback({
                "file_id": fid, "parser": "markitdown", "parser_version": "0.0",
                "status": "metadata_only", "failure_reason": "empty extraction", "chunks": [],
            })
            return
        chunks = chunk_markdown(text)
        post_callback({
            "file_id": fid, "parser": "markitdown", "parser_version": "0.0",
            "status": "parsed", "chunks": chunks,
        })
        print(f"  ok — {len(chunks)} chunks")
    except Exception as e:
        post_callback({
            "file_id": fid, "parser": "markitdown", "parser_version": "0.0",
            "status": "failed", "failure_reason": f"parse_failed: {type(e).__name__}: {e}"[:1800],
            "chunks": [],
        })
        print(f"  failed: {e}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-files", type=int, default=50)
    args = ap.parse_args()

    rows = claim_pending(args.max_files)
    if not rows:
        print("no work")
        return 0
    print(f"claimed {len(rows)} file(s)")
    for r in rows:
        parse_one(r)
        time.sleep(0.5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
