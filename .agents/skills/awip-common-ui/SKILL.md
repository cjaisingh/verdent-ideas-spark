---
name: awip-common-ui
description: Per-tenant branding + the 5 swap-allowed CSS tokens; the contract any sibling project (Client Goals, future domains) pulls from to look like Core. Use when touching branding, the design-system tokens endpoint, /admin/branding, BrandingProvider, or onboarding a new sibling project.
---

# AWIP Common UI

Core hosts the operator look-and-feel as the canonical baseline. Siblings pull tokens from `GET /design-system/tokens.json` on `awip-api`; they do **not** redeclare them.

## The five rules

1. **14 tokens locked, 5 swap-allowed.** Only `primary`, `primary-foreground`, `accent`, `accent-foreground`, `ring` can change per tenant. Everything else (surfaces, status, tints) stays Core.
2. **Foregrounds are derived, not chosen.** `src/lib/branding/contrast.ts → deriveForegroundHex` picks `#FFFFFF` or `#000000` against the brand colour and `passesAA` enforces 4.5:1. Sub-AA only with an explicit `accessibility_override_reason` on the row.
3. **`BrandingProvider` is the only writer to `:root`** for the 5 swap tokens. Resolution order: `?tenant=` → `localStorage.awip_active_tenant` → most-recent row → defaults.
4. **Mutations emit `capability_events`** (`kind='tenant_branding_changed'`). Realtime is on, so the provider hot-reloads.
5. **Spec version travels with the payload.** `SPEC_VERSION` lives in `supabase/functions/_shared/contracts/design-system-tokens.ts`. Bump per `docs/common-domain-ui.md §6`.

## When working in this area

- Don't add a new swap-allowed token without bumping `SPEC_VERSION` (minor), updating `SWAP_TOKENS` in `BrandingProvider`, and notifying siblings via CHANGELOG.
- Don't write `--primary` (or any swap token) from any file other than `BrandingProvider`. Use semantic tokens in components.
- Don't store logo URLs in the row — store the bucket path, derive the URL at read time. Bucket: `tenant-branding`.
- Don't bypass the AA gate in `/admin/branding`. The override is operator-gated and audit-logged.
- Don't add typography, surface-mode, or theme-preset swapping — those are explicitly v1.1+.

## Spec & contract

- `docs/common-domain-ui.md` — full spec.
- `supabase/functions/_shared/contracts/design-system-tokens.ts` — typed contract.
- `mem://features/common-domain-ui`.
