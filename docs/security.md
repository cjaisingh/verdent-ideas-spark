# Security

This document explains how AWIP Core enforces access control: who can read what, who can write what, and how cross-project calls are authenticated. It is the reference for anyone reviewing RLS policies, auth flows, or service-token plumbing.

Cross-links: [`architecture.md`](./architecture.md) · [`api.md`](./api.md) · [`development.md`](./development.md)

---

## 1. Threat model in one paragraph

AWIP Core stores two things that matter: an organization's **OKR tree** (strategic intent) and its **capability manifest** (what the system can do). Both are read by an operator UI (this project) and written either by trusted humans (operators) or by sibling Lovable projects acting as services (Discovery AI today; module/agent projects tomorrow). The threats we defend against are: (a) an unauthenticated browser reading the database directly via the anon key, (b) a logged-in non-operator user escalating into operator data, (c) a sibling project impersonating a different sibling, and (d) replays of write calls causing duplicate state. Everything below maps back to one of those four.

---

## 2. Identities and roles

There are exactly **three** identity classes in the system:

| Identity | How it authenticates | What it can do |
|---|---|---|
| **Anonymous browser** | Supabase anon/publishable key only | Nothing. All tables require an `operator` or `admin` role; all write endpoints reject. |
| **Operator user** | Supabase Auth JWT + `operator` (or `admin`) row in `public.user_roles` | Read every table in `public`; call every `/awip-api/*` endpoint. |
| **Sibling project (service)** | `x-awip-service-token` header matching the `AWIP_SERVICE_TOKEN` secret | Call every `/awip-api/*` write endpoint as `actor = "service:discovery_ai"`. **Does not** get a Supabase session — cannot read tables directly. |

Roles live in their own table (`public.user_roles`) — never on a profile or `auth.users` column. This is the standard Supabase pattern and is required to avoid privilege-escalation bugs.

```sql
-- enum
create type public.app_role as enum ('admin', 'operator');

-- table
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,        -- references auth.users(id) logically; not a hard FK
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;
```

### `has_role()` — the single source of truth

Every RLS policy that gates "is this person an operator?" goes through one `SECURITY DEFINER` function. This is what prevents the classic *infinite recursion in policy* footgun (a policy on `user_roles` that queries `user_roles`).

```sql
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;
```

Rules:
- Every operator-gated policy calls `has_role(auth.uid(), 'operator'::app_role)` — never an inline subquery against `user_roles`.
- The function is `SECURITY DEFINER` with a pinned `search_path = public` so it cannot be hijacked by a shadow `user_roles` table in another schema.
- `STABLE` lets Postgres cache the result inside a single statement.

### Bootstrapping the first operator

The very first signup is automatically promoted via a trigger — otherwise you'd have a chicken-and-egg problem (no operator exists, so no one can grant `operator`). Subsequent signups get **no role** and must be granted access by an existing admin.

```sql
create or replace function public.bootstrap_first_operator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.user_roles where role = 'operator') then
    insert into public.user_roles (user_id, role) values (new.id, 'operator');
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end;
$$;
```

This trigger is wired to `auth.users` insert. After bootstrap, granting roles is an **admin-only** operation through the `user_roles` policies below.

---

## 3. RLS policy matrix

RLS is enabled on **every** table in `public`. There are no exceptions. The policy shape is intentionally narrow: operators can read; nobody writes from a client.

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `tenants` | operator | operator (only writable table from client — needed to create tenants from the UI) |
| `okr_nodes` | operator | **denied** — only the edge function (service role) writes |
| `okr_measurements` | operator | **denied** |
| `okr_node_events` | operator | **denied** — append-only via service role |
| `capabilities` | operator | **denied** — written by edge function via `POST /capabilities/register` |
| `capability_connectors` | operator | **denied** |
| `capability_events` | operator | **denied** — append-only |
| `api_call_logs` | operator | **explicit deny** (`USING false / WITH CHECK false`) — only service role writes |
| `idempotency_keys` | **explicit deny** | **explicit deny** — only service role touches this table |
| `user_roles` | self (`auth.uid() = user_id`) | admin only (`has_role(auth.uid(), 'admin')`) |

### Why writes go through the edge function, not the JS client

Every meaningful mutation in this system has a side effect that must be transactional with the write itself:

- Mutating an `okr_node` must append a row to `okr_node_events`.
- Mutating a `capability` must append a row to `capability_events`.
- Idempotent endpoints must atomically check + write `idempotency_keys`.
- Every call must append a row to `api_call_logs`.

If we let the browser write directly, we'd need either fragile client-side discipline or triggers that duplicate handler logic. Instead the edge function holds the **service role key** and is the only writer. RLS on the underlying tables denies clients by default — defence in depth — so a leaked anon key still cannot mutate anything.

The single exception is `tenants`, which has an `operators write tenants` policy because creating a tenant from the UI is a trivial single-row insert with no side-effect contract. If a tenant ever needs an `tenant_created` event, this policy moves to the edge function too.

### Sensitive columns

There are no PII or secret columns in the public schema today. `actor` strings in `api_call_logs` and event tables identify either a Supabase user id (`user:<uuid>`) or a service (`service:discovery_ai`) — both are non-sensitive because the underlying secrets are not stored in these tables.

---

## 4. Edge-function authorization

`supabase/functions/awip-api/index.ts` is the only entry point for writes and the only entry point that does cross-table aggregation reads. Every request flows through one `authorize(req)` call before a handler runs.

```ts
async function authorize(req: Request) {
  // 1. Service-token path (cross-project, no Supabase session)
  const serviceToken = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided    = req.headers.get("x-awip-service-token");
  if (serviceToken && provided && provided === serviceToken) {
    return { ok: true, actor: "service:discovery_ai" };
  }

  // 2. Operator JWT path (browser)
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, error: "missing auth" };
  const jwt = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return { ok: false, error: "invalid jwt" };

  const { data: roles } = await supabase
    .from("user_roles").select("role").eq("user_id", data.user.id);
  const isOp = roles?.some(r => r.role === "operator" || r.role === "admin");
  if (!isOp) return { ok: false, error: "not operator" };

  return { ok: true, actor: `user:${data.user.id}` };
}
```

Properties worth being explicit about:

1. **Service token wins.** If both a service token and a JWT are present, the service token short-circuits. There is no scenario where one upgrades the other.
2. **Constant-string comparison.** The token is compared as a single equality check against an env var. Tokens are high-entropy random strings, so timing-attack resistance is not relevant at this scale; if we ever accept multiple tokens, switch to a constant-time comparator.
3. **JWT is verified by Supabase, not by us.** `supabase.auth.getUser(jwt)` calls into GoTrue with `SUPABASE_JWKS` configured — we never parse JWT claims by hand and never trust client-supplied `user_id` / `role` claims.
4. **Roles are re-checked on every request.** We do not cache `(user_id, role)` in memory. Revoking a role takes effect immediately on the next request.
5. **Failed auth returns `401` and is logged** to `api_call_logs` with `actor: "anonymous"` and the failure reason in `error`. This gives us an audit trail for unauthorized attempts.

### What about CORS?

CORS is permissive (`Access-Control-Allow-Origin: *`) on purpose: Lovable preview/published URLs are not stable hostnames and the auth model does not depend on browser origin. **CORS is not a security boundary here** — auth is. Anything sensitive lives behind `authorize()`.

---

## 5. Service tokens and cross-project trust

AWIP is designed as a constellation of Lovable projects (Discovery AI, Control Plane, future module/agent projects). They communicate by HTTP only — **no project reaches into another's database** — so authentication between them must work without a shared Supabase session.

### How it works today

1. AWIP Core has one secret: `AWIP_SERVICE_TOKEN` (random ≥ 32 bytes, stored via Lovable Cloud secrets).
2. Each sibling project that calls AWIP Core stores the **same value** as a secret in *its own* edge functions (e.g. Discovery AI stores it as `AWIP_SERVICE_TOKEN` too).
3. Sibling project sends `x-awip-service-token: $AWIP_SERVICE_TOKEN` on every request to `/awip-api/*`.
4. AWIP Core's `authorize()` accepts the request with `actor = "service:discovery_ai"` and runs the handler with the service-role DB client.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/awip-api/okr/ingest" \
  -H "x-awip-service-token: $AWIP_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ingest-2026-05-06-acme-v1" \
  -d '{ "tenant_id": "...", "nodes": [...] }'
```

### What this design buys us

- **Sibling projects need no Supabase Auth.** They cannot mint operator JWTs, cannot read the database directly (no anon key for AWIP Core), and cannot impersonate a specific human.
- **Revocation is one secret rotation.** Rotate `AWIP_SERVICE_TOKEN` in AWIP Core and every sibling that hasn't been re-authorized stops working immediately.
- **Audit trail is honest.** Every service-token call lands in `api_call_logs` with `actor = "service:discovery_ai"`, distinguishable from any human action.

### What this design does *not* do (yet)

- **Per-sibling identity.** Today every service caller authenticates as `service:discovery_ai` because there is only one sibling. When a second writer (e.g. an acting module) comes online, we will move to per-project tokens (`AWIP_SERVICE_TOKEN_DISCOVERY`, `AWIP_SERVICE_TOKEN_MODULE_FOO`, …) and have `authorize()` map each token to a distinct `actor` string. The handler signature already takes `actor` so handlers do not need to change.
- **Per-tenant scoping.** A service token is currently full-system. If a future sibling should only act for one tenant, this will be enforced at the handler layer (the `actor → allowed_tenant_ids` map) rather than via separate tokens.
- **Token expiry.** Tokens are long-lived. Rotation is operator-driven. We accept this in exchange for operational simplicity; high-frequency rotation can be added later by switching to short-lived signed tokens (e.g. JWTs signed by AWIP Core, verified by siblings — *not* the other direction).

### Rotating the service token

1. Generate a new value: `openssl rand -base64 48`.
2. In AWIP Core: update the `AWIP_SERVICE_TOKEN` secret via Lovable Cloud → Connectors → Secrets.
3. In each sibling project: update *their* `AWIP_SERVICE_TOKEN` secret to the new value.
4. Verify with a `curl` against `GET /capabilities` from the sibling. Old token starts returning `401`.

There is no overlap window. If you need zero-downtime rotation, temporarily extend `authorize()` to accept either of two tokens, deploy, rotate siblings, then drop the old one.

---

## 6. Idempotency as a safety property

Idempotency keys are usually filed under "reliability", but they are also a **security control**: they make replay attacks against write endpoints harmless.

- `POST /okr/ingest` honours `Idempotency-Key`. A replay with the same key returns the same stored response and does **not** re-execute the side effects.
- `idempotency_keys` is locked down with `USING false / WITH CHECK false` — no client can read or write it. Only the edge function (service role) does.
- Keys are scoped (`scope` column), so the same key value used on a different endpoint is treated as a different request.

When we extend idempotency to other write endpoints (`/okr/:id/spawn`, `/okr/:id/supersede`, `/capabilities/register`), the same property holds.

---

## 7. Audit log

`api_call_logs` is the security log of record. Every request — successful or not, operator or service — appends one row with:

- `route`, `method`, `status_code`, `duration_ms`
- `actor` (`user:<uuid>` | `service:discovery_ai` | `anonymous`)
- `idempotency_key`, `idempotent_replay`
- `tenant_id` when known
- `request_summary` and `response_summary` (sanitised — no full payloads, no secrets)
- `error` string for failures

Operators can read this table directly via the UI. The table has no DELETE policy — rows are append-only from the application's perspective. Pruning, if it becomes necessary, will be a scheduled migration job, not an interactive operation.

---

## 8. What an operator should check periodically

A short checklist for the human reviewing this system every quarter:

1. **`supabase--linter` is clean.** No tables without RLS; no policies with `USING true` outside of intentional public surfaces (there are none today).
2. **`user_roles` membership is current.** Anyone with `operator` or `admin` should still need it. Removed teammates have their rows deleted.
3. **Service token has been rotated** within the last 90 days.
4. **`api_call_logs` shows no sustained 401 traffic** from a single actor — that's either a misconfigured sibling or someone probing.
5. **No new tables in `public` without RLS enabled** — when adding a table via migration, the `enable row level security` and the policy go in the *same* migration file.
6. **No edge function has been added that bypasses `authorize()`.** Grep `supabase/functions` for `serve(` and confirm every entry point calls it.

---

## 9. Out of scope (intentionally)

- **End-user (non-operator) auth.** AWIP Core has no public surface. There is no "customer" persona that signs in. If a downstream product needs that, it lives in another project and calls AWIP Core via service token.
- **Encryption at rest of specific columns.** Postgres is encrypted at rest by the platform. We do not currently column-encrypt anything because no column is sensitive enough to warrant the operational cost.
- **Rate limiting.** There is none today. Service tokens are trusted; operator JWTs are gated by Supabase Auth's own limits. Add per-actor limits to `authorize()` if abuse becomes a concern.

---

## 10. Reference: changing the security posture

When you intend to change anything in this document — adding a public endpoint, adding a new role, granting client write access to a new table — you must also:

1. Update this file in the same change.
2. Update `mem://security-memory` via the `update_memory` tool so future automated scans don't flag the intentional change.
3. Re-run `supabase--linter` and `security--run_security_scan` and confirm no new findings.
