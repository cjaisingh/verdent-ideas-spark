import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? "";
const OPERATOR_PASSWORD = process.env.E2E_OPERATOR_PASSWORD ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPERATOR_EMAIL || !OPERATOR_PASSWORD) {
  // Tests will skip with a clear message in beforeAll
  // (we don't throw at import-time so listing tests still works)
  // eslint-disable-next-line no-console
  console.warn(
    "[playwright] Missing E2E env: E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD. Tests will skip.",
  );
}

const projectRef = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "";
  }
})();
const STORAGE_KEY = `sb-${projectRef}-auth-token`;

export type AuthFixtures = {
  authedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page, baseURL }, use) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY || !OPERATOR_EMAIL || !OPERATOR_PASSWORD,
      "E2E credentials not configured",
    );

    // Sign in once via the JS SDK to mint a real session, then inject it
    // into localStorage before any app code loads.
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.signInWithPassword({
      email: OPERATOR_EMAIL,
      password: OPERATOR_PASSWORD,
    });
    if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message}`);

    const session = data.session;
    const storageValue = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: session.token_type,
      user: session.user,
    });

    // Seed localStorage on the app origin before navigation.
    await page.goto(baseURL ?? "/", { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ([k, v]) => {
        localStorage.setItem(k, v);
      },
      [STORAGE_KEY, storageValue],
    );

    await use(page);
  },
});

export { expect };
