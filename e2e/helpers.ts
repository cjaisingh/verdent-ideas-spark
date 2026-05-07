import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_TOKEN = process.env.E2E_AWIP_SERVICE_TOKEN;
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL;
const OPERATOR_PASSWORD = process.env.E2E_OPERATOR_PASSWORD;
// Optional: a user with ONLY the operator role (no admin). Used to verify
// admin-only tables/RPCs reject non-admin operators. If absent, those tests skip.
const OPERATOR_ONLY_EMAIL = process.env.E2E_OPERATOR_ONLY_EMAIL;
const OPERATOR_ONLY_PASSWORD = process.env.E2E_OPERATOR_ONLY_PASSWORD;

export const env = {
  SUPABASE_URL: SUPABASE_URL!,
  SUPABASE_ANON_KEY: SUPABASE_ANON_KEY!,
  SERVICE_TOKEN: SERVICE_TOKEN ?? "",
  OPERATOR_EMAIL: OPERATOR_EMAIL ?? "",
  OPERATOR_PASSWORD: OPERATOR_PASSWORD ?? "",
  OPERATOR_ONLY_EMAIL: OPERATOR_ONLY_EMAIL ?? "",
  OPERATOR_ONLY_PASSWORD: OPERATOR_ONLY_PASSWORD ?? "",
  HAS_OPERATOR_ONLY: Boolean(OPERATOR_ONLY_EMAIL && OPERATOR_ONLY_PASSWORD),
  FN_URL: `${SUPABASE_URL}/functions/v1/awip-api`,
};

export function requireEnv() {
  const missing: string[] = [];
  if (!env.SUPABASE_URL) missing.push("E2E_SUPABASE_URL or VITE_SUPABASE_URL");
  if (!env.SUPABASE_ANON_KEY)
    missing.push("E2E_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!env.OPERATOR_EMAIL) missing.push("E2E_OPERATOR_EMAIL");
  if (!env.OPERATOR_PASSWORD) missing.push("E2E_OPERATOR_PASSWORD");
  if (missing.length) {
    throw new Error(
      `Missing required env vars for e2e:\n  - ${missing.join("\n  - ")}\n` +
        "See e2e/README.md for setup.",
    );
  }
}

export function anonClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function operatorClient() {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({
    email: env.OPERATOR_EMAIL,
    password: env.OPERATOR_PASSWORD,
  });
  if (error) throw new Error(`Operator sign-in failed: ${error.message}`);
  return { client: c, accessToken: data.session!.access_token, userId: data.user!.id };
}

export async function callFn(
  path: string,
  init: RequestInit & { auth?: "jwt" | "service" | "none"; jwt?: string } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.auth === "jwt" && init.jwt) headers.set("authorization", `Bearer ${init.jwt}`);
  if (init.auth === "service") headers.set("x-awip-service-token", env.SERVICE_TOKEN);
  // Always send the publishable key — Supabase function gateway requires it.
  if (!headers.has("apikey")) headers.set("apikey", env.SUPABASE_ANON_KEY);
  const res = await fetch(`${env.FN_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json as Record<string, unknown> };
}
