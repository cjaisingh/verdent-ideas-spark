// Typed contract for GET /design-system/tokens.json
// Read-only contract surface served by `awip-api`. Siblings (Client Goals,
// future domains) call this to pull Core's token defaults + the active
// tenant's branding overrides.
//
// Mirrors mem://preferences/contract-first and docs/agents/contract-checklist.md.

export const SPEC_VERSION = "1.0.0" as const;

// HSL triple as stored in CSS custom properties (e.g. "216 94% 58%").
// Note: relaxed to plain string here for runtime serialisation; validated by
// `isHslTriple` at boundaries.
export type HslString = string;

export const TOKEN_NAMES = [
  // Surfaces — never swap per tenant
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "destructive",
  "destructive-foreground",
  // Swap-allowed per tenant
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "ring",
  // Tints — never swap
  "tint-night",
  "tint-event",
  "tint-approval",
  "tint-discussion",
  "tint-capability",
  "tint-risk",
  "tint-okr",
  "tint-insight",
  "brand-primary",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

export const SWAP_ALLOWED_TOKENS = [
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "ring",
] as const satisfies readonly TokenName[];

export type SwapAllowedToken = (typeof SWAP_ALLOWED_TOKENS)[number];

export interface TenantBrandingLogos {
  light_url: string | null;
  dark_url: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
}

export interface TenantBrandingOverrides {
  tenant_id: string;
  display_name: string | null;
  overrides: Record<SwapAllowedToken, HslString>;
  logo: TenantBrandingLogos;
}

export interface TokensResponse {
  spec_version: string;
  defaults: Record<TokenName, HslString>;
  tenant?: TenantBrandingOverrides;
}

// Validators ----------------------------------------------------------------

const HSL_TRIPLE_RE = /^\s*\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHslTriple(v: unknown): v is HslString {
  return typeof v === "string" && HSL_TRIPLE_RE.test(v);
}

export function isHexColour(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

export function assertTokensResponse(r: unknown): asserts r is TokensResponse {
  if (!r || typeof r !== "object") throw new Error("tokens: not an object");
  const obj = r as Record<string, unknown>;
  if (typeof obj.spec_version !== "string") {
    throw new Error("tokens: spec_version missing");
  }
  if (!obj.defaults || typeof obj.defaults !== "object") {
    throw new Error("tokens: defaults missing");
  }
  for (const name of TOKEN_NAMES) {
    const v = (obj.defaults as Record<string, unknown>)[name];
    if (!isHslTriple(v)) {
      throw new Error(`tokens: defaults.${name} not an HSL triple: ${String(v)}`);
    }
  }
  if (obj.tenant !== undefined) {
    const t = obj.tenant as Record<string, unknown>;
    if (typeof t.tenant_id !== "string") {
      throw new Error("tokens: tenant.tenant_id missing");
    }
    const ov = t.overrides as Record<string, unknown> | undefined;
    if (!ov) throw new Error("tokens: tenant.overrides missing");
    for (const name of SWAP_ALLOWED_TOKENS) {
      if (!isHslTriple(ov[name])) {
        throw new Error(`tokens: tenant.overrides.${name} invalid`);
      }
    }
  }
}

// Core default tokens, mirrored from src/index.css `:root` block.
// When index.css changes, update this map and bump SPEC_VERSION + CHANGELOG.
export const CORE_DEFAULT_TOKENS: Record<TokenName, HslString> = {
  background: "0 0% 100%",
  foreground: "222.2 84% 4.9%",
  card: "0 0% 100%",
  "card-foreground": "222.2 84% 4.9%",
  popover: "0 0% 100%",
  "popover-foreground": "222.2 84% 4.9%",
  muted: "210 40% 96.1%",
  "muted-foreground": "215.4 16.3% 46.9%",
  border: "214.3 31.8% 91.4%",
  input: "214.3 31.8% 91.4%",
  destructive: "0 84.2% 60.2%",
  "destructive-foreground": "210 40% 98%",
  primary: "222.2 47.4% 11.2%",
  "primary-foreground": "210 40% 98%",
  accent: "210 40% 96.1%",
  "accent-foreground": "222.2 47.4% 11.2%",
  ring: "222.2 84% 4.9%",
  "tint-night": "262 60% 50%",
  "tint-event": "215 16% 47%",
  "tint-approval": "38 92% 45%",
  "tint-discussion": "217 91% 55%",
  "tint-capability": "158 64% 40%",
  "tint-risk": "0 75% 50%",
  "tint-okr": "199 89% 48%",
  "tint-insight": "40 90% 61%",
  "brand-primary": "216 94% 58%",
};
