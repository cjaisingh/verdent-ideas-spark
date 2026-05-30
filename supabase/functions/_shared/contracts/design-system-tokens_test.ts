// Deno test for the design-system tokens contract.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertTokensResponse,
  CORE_DEFAULT_TOKENS,
  isHexColour,
  isHslTriple,
  SPEC_VERSION,
  SWAP_ALLOWED_TOKENS,
  TOKEN_NAMES,
  type TokensResponse,
} from "./design-system-tokens.ts";

Deno.test("HSL triple validator accepts canonical forms", () => {
  assert(isHslTriple("216 94% 58%"));
  assert(isHslTriple("222.2 47.4% 11.2%"));
  assert(isHslTriple("0 0% 100%"));
});

Deno.test("HSL triple validator rejects garbage", () => {
  assert(!isHslTriple("rgb(0,0,0)"));
  assert(!isHslTriple("#3B82F6"));
  assert(!isHslTriple("216, 94%, 58%"));
  assert(!isHslTriple(""));
  assert(!isHslTriple(undefined));
});

Deno.test("hex colour validator", () => {
  assert(isHexColour("#3B82F6"));
  assert(isHexColour("#ffffff"));
  assert(!isHexColour("#fff"));
  assert(!isHexColour("3B82F6"));
});

Deno.test("CORE_DEFAULT_TOKENS covers every TOKEN_NAME with a valid triple", () => {
  for (const name of TOKEN_NAMES) {
    const v = CORE_DEFAULT_TOKENS[name];
    assert(isHslTriple(v), `${name} = ${v}`);
  }
});

Deno.test("assertTokensResponse round-trips a minimal payload", () => {
  const payload: TokensResponse = {
    spec_version: SPEC_VERSION,
    defaults: CORE_DEFAULT_TOKENS,
  };
  assertTokensResponse(payload);
});

Deno.test("assertTokensResponse round-trips a payload with tenant overrides", () => {
  const payload: TokensResponse = {
    spec_version: SPEC_VERSION,
    defaults: CORE_DEFAULT_TOKENS,
    tenant: {
      tenant_id: "00000000-0000-0000-0000-000000000000",
      display_name: "Acme",
      overrides: {
        primary: "216 94% 58%",
        "primary-foreground": "0 0% 100%",
        accent: "216 94% 58%",
        "accent-foreground": "0 0% 100%",
        ring: "216 94% 58%",
      },
      logo: { light_url: null, dark_url: null, favicon_url: null, og_image_url: null },
    },
  };
  assertTokensResponse(payload);
});

Deno.test("assertTokensResponse rejects malformed HSL in defaults", () => {
  const bad = {
    spec_version: SPEC_VERSION,
    defaults: { ...CORE_DEFAULT_TOKENS, primary: "rgb(0,0,0)" },
  };
  assertThrows(() => assertTokensResponse(bad), Error, "primary");
});

Deno.test("SWAP_ALLOWED_TOKENS is a strict subset of TOKEN_NAMES", () => {
  for (const t of SWAP_ALLOWED_TOKENS) {
    assert(TOKEN_NAMES.includes(t));
  }
  assertEquals(SWAP_ALLOWED_TOKENS.length, 5);
});
