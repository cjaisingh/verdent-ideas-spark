## Logo integration plan

Use the two uploaded images as the official AWIP logos:
- **Icon** (square A-mark) → favicon, PWA icons, sidebar collapsed state, mobile.
- **Wordmark** (A + "AWIP" + tagline) → sidebar expanded header, `/` landing hero, auth page, `/trust`.

### Files to add
Copy uploads into `src/assets/`:
- `src/assets/awip-icon.png` (from `Screenshot_2026-05-24_at_20.36.03.png`)
- `src/assets/awip-wordmark.png` (from `Screenshot_2026-05-24_at_20.35.44.png`)

Also copy a 512px version to `public/` for PWA + favicon use:
- `public/awip-icon-512.png`
- `public/awip-icon-192.png` (resized)
- `public/favicon.png` (resized to 32px)

### Code touchpoints
1. **`index.html`** — swap favicon + `apple-touch-icon` to new icon; update `<title>`/og-image if currently generic.
2. **`public/companion.webmanifest`** — repoint `companion-icon-*` references (or add new icon paths) so the PWA install uses the A-mark.
3. **`src/components/OperatorLayout.tsx` / `AppSidebar.tsx`** — show wordmark when sidebar expanded, icon when collapsed (current text-only header replaced).
4. **`src/pages/Index.tsx`** — add wordmark above the "AWIP Core" eyebrow on the landing hero.
5. **`src/pages/Auth.tsx`** — add icon or wordmark at top of sign-in card.
6. **`src/pages/Trust.tsx`** — add wordmark to trust page header (public-facing).

No changes to backend, design tokens, or color system. The dark-navy background of the logos already matches `--background` in dark mode; on light mode we'll wrap the wordmark in a dark container (or use the icon alone).

### Out of scope
- Generating SVG versions (PNG is fine for v1; can vectorise later).
- Rebranding email templates, HeyGen video intros, or PDF exports.
- Updating social/OG preview images beyond favicon.
- Changing the `--brand-primary` token or any palette values.

### Validation
- Visual check at `/`, `/auth`, `/trust`, `/dashboard` (sidebar expanded + collapsed), and mobile viewport.
- Favicon visible in browser tab.
- PWA install on `/companion` shows the A-mark.

Confirm scope and I'll implement.