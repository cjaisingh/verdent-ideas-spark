## Goal

Ship the **AWIP Common Domain UI/UX spec v1** — Core's look codified as the shared baseline for every sibling project (Client Goals, future domains), with per-tenant branding (full primary swap + logo kit + favicon + OG), WCAG-AA-auto-derived foreground, multi-tenant picker + resolver, and a skill that tells sibling agents to pull from Core instead of inventing.

## Non-goals

- Right-panel toggle (deferred to v1.1).
- Surface-mode (light/dark/system) per-tenant toggle (v1.1).
- Cyberpunk/synthwave/preset themes (rejected — see prior chat; would fight `docs/design-system.md` §1).
- Per-tenant typography or `background`/`foreground`/`destructive`/`tint-*` swaps (locked for accessibility).
- npm package distribution to siblings (skill + JSON endpoint is the mechanism).

## Blast radius & Core rule / ADR / FM-AI cited

**Touches**
- New table `public.tenant_branding`; new storage bucket `tenant-branding`.
- `src/index.css` (CSS-var contract documented, not changed).
- `src/main.tsx` (mount `BrandingProvider` inside existing `HelmetProvider`).
- New `src/lib/branding/{contrast.ts, BrandingProvider.tsx, TenantLogo.tsx}`.
- New page `src/pages/AdminBranding.tsx` + route.
- `supabase/functions/awip-api` (new route `GET /design-system/tokens.json` — no new fn).
- New doc `docs/common-domain-ui.md`.
- New skill draft `.agents/skills/awip-common-ui/`.
- Memory: `mem://index.md` Core line + `mem://features/common-domain-ui.md`.

**Core rule cited**: AGENTS.md "Roles live in `public.user_roles`, gated by `has_role()`"; CONTEXT.md substrate rule (every manifest change emits an event — branding mutations emit a `capability_events` row).

**ADR cited**: `docs/adr/0002-service-token-and-idempotency.md` (the tokens.json route is a read-only contract surface, subject to the same auth model as the rest of `awip-api`).

**FM-AI failure mode defused**: brand drift across domains — sibling projects re-inventing colours/logos produces inconsistent operator experience and weakens the "Core is source of truth" stance (`docs/why-awip.md`).

## Alternatives considered

1. **Chosen — Core hosts spec + tokens.json + skill** (option c+d from earlier). Siblings pull. Pros: one source of truth, easy to version, no package plumbing. Cons: pull discipline relies on the skill being applied.
2. **Rejected — Shared `@awip/ui` npm package**. Pros: cleanest dependency graph. Cons: Lovable projects don't share `node_modules`; publish/version cadence too heavy for current pace.
3. **Rejected — Copy-paste `docs/ui-spec.md` only**. Pros: zero infra. Cons: drifts on day one; no machine-readable token contract for agents.
4. **Rejected — Full theme preset system (cyberpunk etc.)**. Pros: more visual flex. Cons: 3× WCAG QA surface forever; fights monochrome-by-default principle in `docs/design-system.md` §1.

## Contract (cron/edge-fn/agent)

No new cron, no new edge function. The `GET /design-system/tokens.json` route is added to existing `awip-api`. Per `mem://preferences/contract-first`, declare its input/output contract in `supabase/functions/_shared/contracts/design-system-tokens.ts`:

```ts
// Input: optional ?tenant_id=uuid
// Output:
export interface TokensResponse {
  spec_version: string;          // e.g. "1.0.0"
  defaults: Record<TokenName, HslString>;
  tenant?: {
    tenant_id: string;
    overrides: {                  // only the four swap-allowed tokens
      primary: HslString;
      primary_foreground: HslString;
      ring: HslString;
      accent: HslString;
      accent_foreground: HslString;
    };
    logo: { light_url: string|null; dark_url: string|null; favicon_url: string|null; og_image_url: string|null };
  };
}
type TokenName = "background"|"foreground"|"primary"|"primary-foreground"|"accent"|"accent-foreground"|"ring"|"destructive"|"destructive-foreground"|"border"|"input"|"muted"|"muted-foreground"|"card"|"card-foreground"|"popover"|"popover-foreground"|"tint-night"|"tint-event"|"tint-approval"|"tint-discussion"|"tint-capability"|"tint-risk"|"tint-okr"|"tint-insight"|"brand-primary";
type HslString = `${number} ${number}% ${number}%`;
```

Auth: operator JWT **or** `x-awip-service-token` (siblings call cross-project). No `Idempotency-Key` — read-only.

## Persona sign-off

- **tenant-manager**: writes are scoped by `tenant_id` and gated by `has_role('admin')`; reads by tenant members are scoped to their own row. No cross-tenant read leak via tokens.json (defaults are public; tenant overrides require auth).
- **capability-architect**: every `tenant_branding` mutation emits a `capability_events` row (`kind='tenant_branding_changed'`) so the manifest history is intact.
- **event-engineer**: trigger `tenant_branding_emit_event` confirmed in the migration; covers insert/update/delete.
- **compliance-auditor**: contrast resolver enforced server-side at write time (rejects sub-AA combos unless an explicit `accessibility_override_reason` is set, mirroring the `night_override_reason` pattern from jobs board).
- **product-historian**: `docs/common-domain-ui.md` carries `spec_version` 1.0.0; bumps via CHANGELOG entry.
- **sentinel**: new check `tenant_branding_contrast_fail` (medium) — surfaces tenants whose stored override fails AA when the algorithm changes.

## Gap checklist

- [x] Idempotency — N/A (read-only endpoint; writes are upserts keyed by `tenant_id`).
- [x] `*_events` emission — `capability_events` via trigger on `tenant_branding`.
- [x] RLS + `has_role` — operator + tenant-member read; admin-only write.
- [x] GRANTs in same migration — `authenticated` + `service_role` on table; public read on bucket via storage policy.
- [x] Realtime publication — `ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_branding;` so `BrandingProvider` hot-reloads.
- [x] `observability_registry` — register `tenant_branding_contrast_fail` watcher + `/admin/branding` surface.
- [x] `withLogger` — N/A (route lives inside already-wrapped `awip-api`).
- [x] No new `any` — `contrast.ts`, provider, page all strictly typed.
- [x] Mem rule — new core line + `mem://features/common-domain-ui.md`.
- [x] CHANGELOG entry — under "Added".
- [x] Doc updates — `docs/common-domain-ui.md` (new); `README.md` link; `docs/design-system.md` cross-reference at top.

## Test plan

- **vitest unit** — `src/lib/branding/contrast.test.ts`:
  - white-on-`#3B82F6` passes AA; black-on-`#3B82F6` fails → resolver returns white.
  - black-on-`#FFD700` passes AA; white-on-`#FFD700` fails → resolver returns black.
  - hex→HSL round-trip stable on the 26 curated palette colours.
- **vitest unit** — `src/lib/branding/BrandingProvider.test.tsx`: writes the five CSS vars to `:root` on mount; realtime update mutates them without remount.
- **Deno test** — `supabase/functions/_shared/contracts/design-system-tokens_test.ts`: schema parse round-trip; rejects malformed HSL.
- **Edge fn smoke** — `supabase--curl_edge_functions` against `awip-api` `/design-system/tokens.json` with and without `tenant_id`; assert 200 + shape.
- **e2e Playwright** — `e2e-playwright/admin-branding.spec.ts`: operator uploads logo + picks `#3B82F6` → preview shows AA-pass badge → submit → reload route → tokens applied to sidebar primary button.
- **RLS** — `e2e/rls-matrix.test.ts` extended: anon cannot select `tenant_branding`; tenant-member can read own row only; admin can write any.

## Validation gates

Run after build, in this order. Each must pass before "done":

1. `bun run lint:ratchet` — zero new `any` (per `mem://preferences/lint-policy`).
2. `bun run rls:verify` — `tenant_branding` policies present and tight.
3. `bunx vitest run src/lib/branding` — all contrast + provider tests green.
4. `bunx playwright test e2e-playwright/admin-branding.spec.ts` — flow green.
5. `supabase--linter` — no warnings on the new migration.
6. `scripts/check-logger-coverage.ts` — passes (no new fn added).
7. Manual: load `/admin/branding`, pick `#0a0a1a` (Midnight Indigo) → foreground auto-resolves to white → sidebar logo + primary button repaint without reload.
8. Poll GH Actions on `cjaisingh/verdent-ideas-spark` after push: Lint & Typecheck + CI green on the merge SHA.

Any red gate → fix in place → re-run from gate 1.

## Out of scope

- Right-panel toggle (context pane / Companion dock).
- Light/dark/system surface-mode toggle per tenant.
- Cross-project npm package for tokens.
- Per-tenant typography swap.
- Auto-bumping siblings' pinned `spec_version` (manual per-sibling CHANGELOG bump).
- Theme presets (cyberpunk / synthwave / brutalist).
- Tenant-self-service branding UI (operator-only in v1; tenant-admin UI later if demanded).

---

## Order of operations (build phase)

1. Contract file `supabase/functions/_shared/contracts/design-system-tokens.ts` + Deno test.
2. Migration: `tenant_branding` table, storage bucket + policies, audit trigger, RLS, GRANTs, realtime publication, observability_registry entry.
3. `src/lib/branding/contrast.ts` + vitest.
4. `BrandingProvider.tsx` + `TenantLogo.tsx` + vitest; mount in `src/main.tsx`.
5. `awip-api` route handler for `/design-system/tokens.json`.
6. `src/pages/AdminBranding.tsx` + route registration + sidebar entry.
7. Playwright + RLS test additions.
8. `docs/common-domain-ui.md` + README cross-link + design-system.md banner.
9. Skill draft under `.agents/skills/awip-common-ui/` (apply via `skills--apply_draft` after review).
10. `mem://index.md` Core line + `mem://features/common-domain-ui.md`.
11. CHANGELOG entry.
12. Run all 8 validation gates; verify GH Actions green on mirror repo.

Used the `rigorous-planning` skill.
