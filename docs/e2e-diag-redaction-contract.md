# E2E Diagnostic Redaction Contract

Reference for anyone modifying `e2e/diag.ts` or `scripts/scrub-e2e-logs.ts`.

## Purpose

E2E tests run in CI with credentials (`SUPABASE_SERVICE_ROLE_KEY`, operator password) in env.  
Test failures may include:
- PostgreSQL error text (`message`, `details`, `hint`)  
- The literal row we tried to insert (`attempted_row`)  
- Arbitrary extra fields (`extra`)  

If a secret leaks into any of those fields, it would be visible in:
1. The console log streamed to GitHub Actions  
2. The `e2e-logs/` artefact (raw.log + diagnostics.jsonl)  
3. The GitHub step summary rendered from diagnostics.jsonl  

This contract defines what is allowed to appear in `E2E_DIAG` JSON, and what **must** be scrubbed.

## Architecture — two layers

| Layer | When it runs | Scope |
|---|---|---|
| **Primary** — `emitDiag()` in `e2e/diag.ts` | Every call site, before `console.error` | Only fields inside the emitted JSON |
| **Defence-in-depth** — `scripts/scrub-e2e-logs.ts` | Once per CI run, after tests finish, before summary / upload | Entire raw.log + every JSONL record |

Both layers import the **same** `redact()` and `scrubString()` from `e2e/diag.ts`.  
Changing one module changes both.

## What gets scrubbed (two mechanisms)

### 1. Key-level redaction — entire value replaced with `[REDACTED]`

If a JSON **key name** matches any of the following case-insensitive substrings, the **entire value** is replaced with `[REDACTED]`, regardless of what the value actually contains.

| Pattern | Example key names that match |
|---|---|
| `pass(word\|phrase)?` | `password`, `passphrase`, `pass` |
| `secret` | `secret`, `client_secret`, `shared_secret` |
| `token` | `token`, `auth_token`, `refresh_token` |
| `api[_-]?key` | `api_key`, `apiKey` |
| `authoriz(ation\|ed)` | `authorization`, `authorized` |
| `bearer` | `bearer`, `bearer_token` |
| `cookie` | `cookie`, `session_cookie` |
| `session` | `session`, `session_id` |
| `private[_-]?key` | `private_key`, `privateKey` |
| `service[_-]?role` | `service_role`, `service_role_key` |
| `anon[_-]?key` | `anon_key`, `anonKey` |
| `access[_-]?key` | `access_key`, `accessKey` |
| `refresh[_-]?token` | `refresh_token`, `refreshToken` |
| `signature` | `signature`, `request_signature` |
| `^otp$` | `otp` |
| `^pin$` | `pin` |

**Allowed keys (examples):** `id`, `name`, `surface_kind`, `tag`, `owner`, `created_at`, `status`, `score`, `matched_kinds`, `band_thresholds_snapshot`.

### 2. Value-level regex scrubbing — secret-like strings replaced in-place

Any **string value** (in `message`, `details`, `hint`, or inside nested objects/arrays) that matches these patterns is replaced with a labelled token.

| What it looks like | Regex (simplified) | Replaced with |
|---|---|---|
| JWT (`eyJ…`.`…`.`…`) | `\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b` | `[REDACTED_JWT]` |
| Supabase key (`sb_…` / `sbp_…`) | `\bsb[a-z]?_[A-Za-z0-9_-]{20,}\b` | `[REDACTED_SUPABASE_KEY]` |
| Bearer header | `\bBearer\s+[A-Za-z0-9._\-+/=]{12,}` | `Bearer [REDACTED]` |
| OpenAI / generic `sk-…` key | `\bsk-[A-Za-z0-9]{20,}\b` | `[REDACTED_API_KEY]` |
| Telegram bot token (`123456:AA…`) | `\b\d{6,12}:[A-Za-z0-9_-]{30,}\b` | `[REDACTED_TELEGRAM_TOKEN]` |
| GitHub PAT (`ghp_…`, `gho_…`, etc.) | `\bgh[pousr]_[A-Za-z0-9]{30,}\b` | `[REDACTED_GITHUB_TOKEN]` |
| Long hex (≥40 chars, probable hash/secret) | `\b[a-f0-9]{40,}\b` | `[REDACTED_HEX]` |
| Long base64-ish blob (≥64 chars) | `\b[A-Za-z0-9+/=_-]{64,}\b` | `[REDACTED_LONG_TOKEN]` |

**Numbers, booleans, short plain strings** (e.g. `"rpc"`, `"e2e"`, `42`, `true`) are never touched.

## Recursive rules

- Objects: every key checked for sensitivity, every value recursed.
- Arrays: every element recursed.
- **Depth cap:** recursion stops at 9 levels (returns `[REDACTED]`).
- **Non-serialisable values** (functions, symbols, etc.) become `[REDACTED]`.

## JSON shape (stable fields)

```json
{
  "ts": "2026-05-30T12:34:56.789Z",
  "event": "unexpected_sqlstate",
  "test_file": "e2e/observability-registry-rpc-kind.test.ts",
  "sqlstate": "23514",
  "message": "new row for relation \"observability_registry\" violates check constraint...",
  "details": "Failing row contains...",
  "hint": null,
  "attempted_row": {
    "surface_kind": "rpc",
    "surface_name": "resolve_entity_logged",
    "owner": "e2e"
  },
  "extra": null
}
```

## Examples — before / after redaction

### Example 1: attempted_row with a secret key

**Before (what the test code passes to `emitDiag`)**
```json
{
  "attempted_row": {
    "surface_kind": "rpc",
    "owner": "e2e",
    "payload": {
      "api_key": "sk-ABCDEFGHIJKLMNOPQRSTUVWX",
      "password": "hunter2",
      "note": "fine"
    }
  }
}
```

**After (what appears in the log)**
```json
{
  "attempted_row": {
    "surface_kind": "rpc",
    "owner": "e2e",
    "payload": {
      "api_key": "[REDACTED]",
      "password": "[REDACTED]",
      "note": "fine"
    }
  }
}
```

### Example 2: error message containing a Bearer token

**Before**
```
failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.abcDEF tail
```

**After**
```
failed with Authorization: Bearer [REDACTED] tail
```

Note: the `eyJ…` JWT is also caught by the JWT regex, but the Bearer regex fires first in this example. Either way the secret is gone.

### Example 3: raw.log defence-in-depth

If a non-`emitDiag` code path (e.g. a vitest banner or a fetch error body) prints:
```
Authorization: Bearer abcdefghijklmnop
```

`scripts/scrub-e2e-logs.ts` rewrites `raw.log` to:
```
Authorization: Bearer [REDACTED]
```

## Changing this contract

1. Update `SENSITIVE_KEY_PATTERNS` or `SENSITIVE_VALUE_PATTERNS` in `e2e/diag.ts`.
2. Add a test case in `e2e/diag.test.ts`.
3. Update **this document**.
4. Update `CHANGELOG.md`.
5. Run `bun run test:e2e:unit` (includes `e2e/diag.test.ts`) before committing.

**Never** weaken a pattern without explicit operator approval — the CI logs are public artefacts.
