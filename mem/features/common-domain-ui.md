---
name: Common Domain UI/UX spec
description: Per-tenant branding + token contract; siblings pull from /design-system/tokens.json instead of inventing
type: feature
---

Core hosts the operator console look as the shared baseline for every sibling project (Client Goals, future domains). Siblings pull from `GET /design-system/tokens.json` on `awip-api` — do NOT redeclare tokens.

**Locked tokens (never swap per tenant):** `background`, `foreground`, `card*`, `popover*`, `muted*`, `border`, `input`, `destructive*`, `tint-*`, `brand-primary`.

**Swap-allowed (5 only):** `primary`, `primary-foreground`, `accent`, `accent-foreground`, `ring`. `*-foreground` are auto-derived server-side via `src/lib/branding/contrast.ts → deriveForegroundHex` (WCAG-AA ≥ 4.5:1); operator override requires `accessibility_override_reason`.

**Storage:** `public.tenant_branding` (one row per `tenant_id`) + `tenant-branding` bucket for logo/favicon/OG. Mutations emit `capability_events` (`kind='tenant_branding_changed'`); table is on `supabase_realtime` so `BrandingProvider` hot-reloads.

**Active tenant resolution (BrandingProvider):** `?tenant=` URL param → `localStorage.awip_active_tenant` → most-recent row → defaults.

**Contract:** `supabase/functions/_shared/contracts/design-system-tokens.ts` — `SPEC_VERSION` 1.0.0, `CORE_DEFAULT_TOKENS`, `SWAP_ALLOWED_TOKENS`. Endpoint auth: operator JWT or `x-awip-service-token`. Read-only, no idempotency key.

**Operator UI:** `/admin/branding` (operator-only). Live preview + AA gate before save.

**v1 out of scope:** right-panel toggle, surface-mode (light/dark/system), theme presets, per-tenant typography, npm package, tenant-self-service UI.

**Full doc:** `docs/common-domain-ui.md`.
