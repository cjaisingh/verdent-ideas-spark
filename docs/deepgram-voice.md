# Deepgram Voice (Realtime STT) Configuration

The Risk Dashboard "Discuss with Copilot" feature uses Deepgram realtime STT.
The browser cannot hold a long-lived Deepgram API key, so the edge function
`deepgram-realtime-token` mints a short-lived JWT via Deepgram's
`POST /v1/auth/grant` endpoint and the browser opens a WebSocket using the
`bearer` subprotocol.

## Required environment variable

| Name               | Where               | Value                                |
|--------------------|---------------------|--------------------------------------|
| `DEEPGRAM_API_KEY` | Lovable Cloud secret | A Deepgram **master API key** (see below) |

Set per environment (staging + production share the same Cloud project, so the
secret value is the same in both — rotate together).

## Required key permissions

The key must be able to call `POST /v1/auth/grant`. Deepgram only grants this
to keys with the **Member**, **Admin**, or **Owner** project role.

A key created with only `usage:write` scope (the default for a self-minted
project key) **will fail** with:

```
403 {"err_code":"FORBIDDEN","err_msg":"Insufficient permissions."}
```

### Creating the key

1. https://console.deepgram.com → select project
2. **API Keys → Create a New API Key**
3. Comment: `awip-realtime-stt-<env>`
4. Permissions / role: **Member** (minimum). Admin works too.
5. Scopes: leave default (the role drives what the key can do; Member can
   call `auth/grant`).
6. Copy the key once and store it as the `DEEPGRAM_API_KEY` Cloud secret.

### Verifying a key works

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://api.deepgram.com/v1/auth/grant \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ttl_seconds":30}'
# expect: 200
```

A successful response looks like:

```json
{ "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...", "expires_in": 30 }
```

The minted token carries scope `asr:write` (project-claims `usage:write`),
which is what the listen WebSocket requires.

## Endpoints used

| Endpoint                              | Caller             | Auth                              |
|---------------------------------------|--------------------|-----------------------------------|
| `POST /v1/auth/grant`                 | Edge function      | `Authorization: Token <master>`   |
| `wss://api.deepgram.com/v1/listen`    | Browser WebSocket  | Subprotocol `["bearer", <jwt>]`   |

The edge function passes `ttl_seconds: 60`. The WebSocket must connect within
that window; in practice it opens within a second of the grant.

## Failure modes & how the client recovers

The client (`src/components/risk/CopilotDiscussionSheet.tsx`, `startVoice`)
retries the mint + connect flow **once** with a 400ms backoff when it sees:

- Token mint HTTP `502`, `401`, `504`
- WebSocket close before open with code `1006`, `1008`, `4001`, `4008`

Anything else (e.g. `403 INSUFFICIENT_PERMISSIONS`) surfaces immediately as a
toast — that means the master key needs replacing, not retrying.

## Operational checklist when the mic breaks

1. Open browser console, look for `[mic] token response` — the body will
   include `deepgram_status` and `deepgram_body` straight from Deepgram.
2. If `deepgram_status: 403` → key role is too low. Create a Member-role key
   and update the `DEEPGRAM_API_KEY` secret.
3. If `deepgram_status: 401` → key is revoked or wrong env value.
4. If WebSocket close `1008` / `4008` after a clean grant → the JWT expired
   before connect; the auto-retry should recover. If it doesn't, check that
   the client uses subprotocol `["bearer", key]` (NOT `["token", key]`).
5. Edge function logs are tagged `[dg-token <reqId>]` — search by reqId
   returned in the error response body.
