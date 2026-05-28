// scheduler-register-endpoint: FM modules register a callback URL once so
// scheduler-tick knows where to POST `remote` handler dispatches.
//
// POST /scheduler-register-endpoint
//   Headers: x-awip-service-token: <module token>
//   Body:    { callback_url: string }
//   Reply:   200 { module, callback_url, created: bool }
//            400/401/403 with { error }
//
// Operators can also call this with Authorization: Bearer <jwt> and body
// `{ module, callback_url }` to register on behalf of a module.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { withLogger } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Authn =
  | { ok: true; actor: string; owning_module: string | null; is_operator: boolean }
  | { ok: false; error: string; status: number };

async function authorize(req: Request): Promise<Authn> {
  const provided = req.headers.get("x-awip-service-token");
  if (provided) {
    const hash = await sha256Hex(provided);
    const { data } = await supabase.rpc("resolve_module_token", { _hash: hash });
    const row = Array.isArray(data) && data.length > 0
      ? (data[0] as { owning_module: string; label: string })
      : null;
    if (!row) return { ok: false, error: "invalid service token", status: 401 };
    return { ok: true, actor: `module:${row.owning_module}`, owning_module: row.owning_module, is_operator: false };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return { ok: false, error: "invalid jwt", status: 401 };
    const { data: roleData } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
    if (!roleData) return { ok: false, error: "admin role required", status: 403 };
    return { ok: true, actor: `operator:${u.user.id}`, owning_module: null, is_operator: true };
  }
  return { ok: false, error: "missing auth", status: 401 };
}

Deno.serve(withLogger("scheduler-register-endpoint", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authn = await authorize(req);
  if (!authn.ok) return json({ error: authn.error }, authn.status);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return json({ error: "invalid json" }, 400); }

  const callback_url = typeof body.callback_url === "string" ? body.callback_url : "";
  if (!/^https?:\/\//i.test(callback_url)) return json({ error: "callback_url: must be https URL" }, 400);

  let module_slug: string | null = authn.owning_module;
  if (authn.is_operator) {
    module_slug = typeof body.module === "string" ? body.module : null;
    if (!module_slug) return json({ error: "module: required when called as operator" }, 400);
  }
  if (!module_slug) return json({ error: "module slug could not be resolved" }, 400);

  const { data: existing } = await supabase.from("module_endpoints")
    .select("module,callback_url").eq("module", module_slug).maybeSingle();

  const { error } = await supabase.from("module_endpoints").upsert({
    module: module_slug,
    callback_url,
    registered_at: new Date().toISOString(),
  }, { onConflict: "module" });
  if (error) return json({ error: error.message }, 500);

  return json({
    module: module_slug,
    callback_url,
    created: !existing,
    actor: authn.actor,
  });
}));
