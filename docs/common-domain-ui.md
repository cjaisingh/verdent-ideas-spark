# Common Domain UI/UX spec

**Spec version:** 1.0.0
**Status:** active (v1, 2026-05-30)
**Source of truth:** this doc + `supabase/functions/_shared/contracts/design-system-tokens.ts` + `src/index.css`.
**Siblings pull via:** `GET https://<core>/functions/v1/awip-api/design-system/tokens.json?tenant_id=<uuid>` with `x-awip-service-token`.

Read alongside [`docs/design-system.md`](./design-system.md) (the underlying visual language) and [`mem://features/common-domain-ui`](../mem/features/common-domain-ui.md).

## 1. Token policy

The CSS-var contract in `src/index.css` is the canonical token surface. Sibling projects MUST NOT redeclare these tokens — they pull from `/design-system/tokens.json`.

| Group | Tokens | Tenant-swappable? |
|---|---|---|
| Surfaces | `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `muted`, `muted-foreground`, `border`, `input` | **No** — locked for accessibility. |
| Status | `destructive`, `destructive-foreground` | **No** — semantic. |
| Brand | `primary`, `primary-foreground`, `accent`, `accent-foreground`, `ring` | **Yes** — 5 tokens swap per tenant. |
| Tints | `tint-*`, `brand-primary` | **No** — Core domain colour-coding. |

`primary-foreground` and `accent-foreground` are **derived server-side** from the picked brand colour by `deriveForegroundHex()` (WCAG-AA contrast ≥ 4.5:1). Operators cannot save a sub-AA combination without an explicit `accessibility_override_reason` (mirrors the `night_override_reason` pattern from jobs board).

## 2. Per-tenant branding

Stored in `public.tenant_branding` (one row per `tenant_id`):

| Column | Purpose |
|---|---|
| `primary_hex`, `accent_hex` | Operator-chosen brand colours. |
| `primary_foreground_hex`, `accent_foreground_hex` | Auto-derived for AA contrast. |
| `logo_light_path`, `logo_dark_path` | Stored in the `tenant-branding` bucket. |
| `favicon_path`, `og_image_path` | Surface metadata; injected by `BrandingProvider`. |
| `display_name`, `spec_version`, `accessibility_override_reason` | Bookkeeping. |

Mutations emit `capability_events` (`kind='tenant_branding_changed'`); the row is published on `supabase_realtime` so `BrandingProvider` hot-reloads without page refresh.

## 3. Active-tenant resolution (frontend)

`BrandingProvider` picks the active tenant in this order:

1. `?tenant=<uuid>` URL search param.
2. `localStorage.awip_active_tenant`.
3. Most-recently-updated `tenant_branding` row the operator can read.
4. None → defaults stay in place.

## 4. Contract endpoint

`GET /design-system/tokens.json` on `awip-api`:

- Auth: operator JWT **or** `x-awip-service-token`.
- Query: `?tenant_id=<uuid>` (optional).
- Response: `TokensResponse` from `supabase/functions/_shared/contracts/design-system-tokens.ts` — `spec_version`, `defaults` (all 26 tokens as HSL triples), and `tenant` (overrides + logo URLs) when a tenant_id is supplied.

Read-only. No idempotency key required.

## 5. Sibling integration checklist

When a sibling project (Client Goals, future domains) renders the operator console:

1. On boot, `fetch` `/design-system/tokens.json?tenant_id=<self>` with the service token.
2. Write `spec_version` to a constant; if it doesn't match the sibling's pinned major, warn and degrade gracefully.
3. Apply `defaults` to `:root` once, then overlay `tenant.overrides`.
4. Render `tenant.logo.light_url` / `dark_url` via the analogue of `<TenantLogo>`.
5. Inject `tenant.logo.favicon_url` + `og_image_url` in `<head>`.

Siblings MUST NOT invent their own brand tokens.

## 6. Versioning

`SPEC_VERSION` lives in the contract file. Bumps:

- **patch** (1.0.x) — copy-edit, new doc cross-link, no token shape change.
- **minor** (1.x.0) — new tokens added, none removed; existing semantics unchanged.
- **major** (x.0.0) — token removed/renamed/semantics changed. Bump + CHANGELOG entry + notify siblings.

## 7. Out of scope (v1)

- Right-panel toggle (v1.1).
- Light/dark/system per-tenant toggle (v1.1).
- Theme presets (cyberpunk/synthwave/etc.) — rejected; would fight monochrome-by-default principle (`docs/design-system.md` §1).
- Per-tenant typography swap.
- Cross-project npm package (the JSON endpoint is the mechanism).
- Tenant-self-service branding UI (operator-only in v1).
