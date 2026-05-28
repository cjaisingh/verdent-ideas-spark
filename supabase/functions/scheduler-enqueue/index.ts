// scheduler-enqueue: operator + per-module service-token write API for the
// W8.1 Global Scheduling Substrate. Idempotent via dedupe_key.
//
// POST /scheduler-enqueue
//   Headers: Authorization: Bearer <jwt>   OR   x-awip-service-token: <module token>
//   Body:    SchedulerJobInput (see _shared/contracts/scheduler.ts)
//   Reply:   200 { id, status, dedupe_key, created: bool }
//            400/401/403/409 with { error }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { withLogger } from "../_shared/logger.ts";
import { validateInput, type SchedulerJobInput } from "../_shared/contracts/scheduler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Authn =
  | { ok: true; actor: string; user_id?: string; owning_module: string | null }
  | { ok: false; error: string; status: number };

async function authorize(req: Request): Promise<Authn> {
  const provided = req.headers.get("x-awip-service-token");
  if (provided) {
    const legacy = Deno.env.get("AWIP_SERVICE_TOKEN");
    if (legacy && provided === legacy) {
      return { ok: true, actor: "service:legacy", owning_module: null };
    }
    const hash = await sha256Hex(provided);
    const { data } = await supabase.rpc("resolve_module_token", { _hash: hash });
    const row = Array.isArray(data) && data.length > 0
      ? (data[0] as { owning_module: string; label: string; token_id: string })
      : null;
    if (!row) return { ok: false, error: "invalid service token", status: 401 };
    return { ok: true, actor: `module:${row.owning_module}:${row.label}`, owning_module: row.owning_module };
  }
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, error: "missing auth", status: 401 };
  const { data, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !data.user) return { ok: false, error: "invalid jwt", status: 401 };
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  const isOp = roles?.some((r) => r.role === "operator" || r.role === "admin");
  if (!isOp) return { ok: false, error: "not operator", status: 403 };
  return { ok: true, actor: `user:${data.user.id}`, user_id: data.user.id, owning_module: null };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(withLogger("scheduler-enqueue", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authn = await authorize(req);
  if (!authn.ok) return json({ error: authn.error }, authn.status);
  ctx.attach("actor", authn.actor);

  let input: SchedulerJobInput;
  try {
    input = validateInput(await req.json());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "invalid input" }, 400);
  }

  // Module-scoped tokens MUST match the payload's owning_module.
  if (authn.owning_module && authn.owning_module !== input.owning_module) {
    return json({
      error: `token scope mismatch: token=${authn.owning_module}, payload=${input.owning_module}`,
    }, 403);
  }
  // Non-operator (module token) callers cannot enqueue awip_core jobs unless legacy.
  if (input.owning_module === "awip_core" && authn.owning_module === null && !authn.user_id && authn.actor !== "service:legacy") {
    return json({ error: "only operators or legacy service token may enqueue awip_core jobs" }, 403);
  }

  // Catalog lookup (warn-not-block on unknown — keeps the operator UI flexible).
  const { data: catalogRow } = await supabase
    .from("scheduler_kind_catalog")
    .select("handler_mode, owning_module, requires_tenant")
    .eq("kind", input.kind)
    .maybeSingle();
  if (catalogRow?.requires_tenant && !input.tenant_id) {
    return json({ error: `kind '${input.kind}' requires tenant_id` }, 400);
  }

  // Idempotent insert.
  const { data: existing } = await supabase
    .from("scheduled_jobs")
    .select("id, status, dedupe_key")
    .eq("owning_module", input.owning_module)
    .eq("dedupe_key", input.dedupe_key)
    .maybeSingle();
  if (existing) {
    return json({ id: existing.id, status: existing.status, dedupe_key: existing.dedupe_key, created: false });
  }

  const { data: inserted, error } = await supabase.from("scheduled_jobs").insert({
    kind: input.kind,
    owning_module: input.owning_module,
    tenant_id: input.tenant_id,
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    payload: input.payload,
    dedupe_key: input.dedupe_key,
    run_at: input.run_at,
    recurrence: input.recurrence,
    max_retries: input.max_retries ?? 3,
    enqueued_by: authn.user_id ?? null,
    enqueued_via_module: authn.owning_module,
  }).select("id, status, dedupe_key").single();

  if (error) {
    // Race: another caller inserted the same dedupe_key — return it.
    if (/duplicate key/i.test(error.message)) {
      const { data: race } = await supabase
        .from("scheduled_jobs")
        .select("id, status, dedupe_key")
        .eq("owning_module", input.owning_module)
        .eq("dedupe_key", input.dedupe_key)
        .single();
      if (race) return json({ ...race, created: false });
    }
    return json({ error: error.message }, 500);
  }

  return json({ ...inserted, created: true }, 200);
}));
