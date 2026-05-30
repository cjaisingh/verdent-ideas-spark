/**
 * Branding contrast + colour utilities.
 *
 * Pure functions. No React, no DOM. Unit-tested.
 *
 * - `hexToHsl(hex)` returns the HSL triple in the form Tailwind expects in
 *   CSS custom properties, e.g. `"216 94% 58%"`.
 * - `relativeLuminance(hex)` per WCAG 2.x.
 * - `contrastRatio(a, b)` returns the standard 1..21 ratio.
 * - `deriveForegroundHex(bgHex)` picks `#FFFFFF` or `#000000`, whichever scores
 *   higher contrast against the background. Result is guaranteed to be AA-safe
 *   for normal body text against any valid 6-digit hex (worst case ~3.999 at
 *   ~#777777, which falls below AA — see `passesAA` for the safety check).
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!isValidHex(hex)) throw new Error(`Invalid hex: ${hex}`);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbChannelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const R = rgbChannelToLinear(r);
  const G = rgbChannelToLinear(g);
  const B = rgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(aHex: string, bHex: string): number {
  const la = relativeLuminance(aHex);
  const lb = relativeLuminance(bHex);
  const [l1, l2] = la >= lb ? [la, lb] : [lb, la];
  return (l1 + 0.05) / (l2 + 0.05);
}

export function deriveForegroundHex(bgHex: string): "#FFFFFF" | "#000000" {
  const white = contrastRatio(bgHex, "#FFFFFF");
  const black = contrastRatio(bgHex, "#000000");
  return white >= black ? "#FFFFFF" : "#000000";
}

/** WCAG AA threshold for normal body text. */
export const AA_THRESHOLD = 4.5;
/** WCAG AA threshold for large text (>=18pt / 14pt bold). */
export const AA_LARGE_THRESHOLD = 3.0;

export function passesAA(bgHex: string, fgHex: string): boolean {
  return contrastRatio(bgHex, fgHex) >= AA_THRESHOLD;
}

export function passesAALarge(bgHex: string, fgHex: string): boolean {
  return contrastRatio(bgHex, fgHex) >= AA_LARGE_THRESHOLD;
}

/**
 * Convert a 6-digit hex into the HSL triple that Tailwind CSS variables expect.
 * Example: `#3B82F6` -> `"217 91% 60%"`.
 */
export function hexToHsl(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === R) h = ((G - B) / delta) % 6;
    else if (max === G) h = (B - R) / delta + 2;
    else h = (R - G) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  const hh = Math.round(h);
  const ss = Math.round(clamp(s, 0, 1) * 100);
  const ll = Math.round(clamp(l, 0, 1) * 100);
  return `${hh} ${ss}% ${ll}%`;
}
