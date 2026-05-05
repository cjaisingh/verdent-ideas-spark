// AWIP Core contract API.
// Routes:
//   GET  /capabilities                     -> list capabilities
//   POST /capabilities/register            -> register a capability (stub for module projects)
//   POST /okr/ingest                       -> ingest a draft OKR tree (idempotent)
//   POST /okr/:id/spawn                    -> spawn a sub-OKR
//   POST /okr/:id/supersede                -> supersede an OKR with a new node
//   GET  /okr/tree?tenant_id=...           -> fetch full tree (incl. superseded)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Auth: require either a valid operator JWT OR the AWIP_SERVICE_TOKEN header (for cross-project calls).
async function authorize(req: Request): Promise<{ ok: boolean; actor: string; error?: string }> {
  const serviceToken = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-awip-service-token");
  if (serviceToken && provided && provided === serviceToken) {
    return { ok: true, actor: "service:discovery_ai" };
  }
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, actor: "", error: "missing auth" };
  const jwt = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return { ok: false, actor: "", error: "invalid jwt" };
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  const isOp = roles?.some((r) => r.role === "operator" || r.role === "admin");
  if (!isOp) return { ok: false, actor: "", error: "not operator" };
  return { ok: true, actor: `user:${data.user.id}` };
}

async function checkIdempotency(scope: string, key: string | null) {
  if (!key) return null;
  const { data } = await supabase
    .from("idempotency_keys")
    .select("response")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();
  return data?.response ?? null;
}

async function storeIdempotency(scope: string, key: string | null, tenantId: string | null, response: unknown) {
  if (!key) return;
  await supabase.from("idempotency_keys").insert({ scope, key, tenant_id: tenantId, response });
}

// ---------- handlers ----------

async function listCapabilities(url: URL) {
  const status = url.searchParams.get("status");
  let q = supabase.from("capabilities").select("*").order("id");
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ capabilities: data });
}

async function registerCapability(req: Request, actor: string) {
  const body = await req.json();
  const required = ["id", "name", "status"];
  for (const k of required) if (!body[k]) return json({ error: `missing ${k}` }, 400);
  const { error } = await supabase.from("capabilities").upsert({
    id: body.id,
    name: body.name,
    description: body.description ?? null,
    status: body.status,
    version: body.version ?? "0.1.0",
    inputs_required: body.inputs_required ?? [],
    outputs_provided: body.outputs_provided ?? [],
    owning_module: body.owning_module ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) return json({ error: error.message }, 500);
  await supabase.from("capability_events").insert({
    capability_id: body.id,
    event_type: "registered",
    payload: body,
    actor,
  });
  return json({ ok: true, id: body.id });
}

async function ingestOkrTree(req: Request, actor: string) {
  const idemKey = req.headers.get("idempotency-key");
  const cached = await checkIdempotency("okr_ingest", idemKey);
  if (cached) return json(cached);

  const body = await req.json();
  const { tenant_slug, tenant_name, nodes } = body as {
    tenant_slug: string;
    tenant_name?: string;
    nodes: Array<{
      client_id: string; // caller-assigned ref so we can wire parent_id
      parent_client_id?: string | null;
      kind: "objective" | "key_result";
      title: string;
      description?: string;
      measurement?: {
        metric_name: string;
        baseline?: number;
        target?: number;
        unit?: string;
        cadence?: string;
        attribution_rules?: Record<string, unknown>;
        data_sources?: unknown[];
        required_capabilities?: string[];
      };
    }>;
  };

  if (!tenant_slug || !Array.isArray(nodes) || nodes.length === 0) {
    return json({ error: "tenant_slug and nodes required" }, 400);
  }

  // tenant upsert
  let { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("slug", tenant_slug)
    .maybeSingle();
  if (!tenant) {
    const ins = await supabase
      .from("tenants")
      .insert({ slug: tenant_slug, name: tenant_name ?? tenant_slug })
      .select()
      .single();
    if (ins.error) return json({ error: ins.error.message }, 500);
    tenant = ins.data;
  }

  // capability validation
  const allReq = new Set<string>();
  for (const n of nodes) {
    n.measurement?.required_capabilities?.forEach((c) => allReq.add(c));
  }
  const warnings: string[] = [];
  if (allReq.size > 0) {
    const { data: caps } = await supabase
      .from("capabilities")
      .select("id,status")
      .in("id", [...allReq]);
    const known = new Map(caps?.map((c) => [c.id, c.status]) ?? []);
    for (const c of allReq) {
      if (!known.has(c)) warnings.push(`unknown capability: ${c}`);
      else if (known.get(c) !== "available") warnings.push(`capability ${c} is ${known.get(c)} (future hook)`);
    }
  }

  // insert nodes in order, mapping client_id -> real id
  const idMap = new Map<string, string>();
  const created: Array<{ client_id: string; id: string }> = [];
  // Sort: objectives first, then KRs; within each, parent before child by simple BFS of client_ids
  const ordered = [...nodes].sort((a, b) => {
    if (!a.parent_client_id && b.parent_client_id) return -1;
    if (a.parent_client_id && !b.parent_client_id) return 1;
    return 0;
  });

  for (const n of ordered) {
    const parent_id = n.parent_client_id ? idMap.get(n.parent_client_id) ?? null : null;
    const ins = await supabase
      .from("okr_nodes")
      .insert({
        tenant_id: tenant!.id,
        parent_id,
        kind: n.kind,
        title: n.title,
        description: n.description ?? null,
        status: "draft",
        created_by: "discovery_ai",
      })
      .select()
      .single();
    if (ins.error) return json({ error: ins.error.message }, 500);
    idMap.set(n.client_id, ins.data.id);
    created.push({ client_id: n.client_id, id: ins.data.id });

    if (n.kind === "key_result" && n.measurement) {
      const m = n.measurement;
      await supabase.from("okr_measurements").insert({
        okr_node_id: ins.data.id,
        metric_name: m.metric_name,
        baseline: m.baseline ?? null,
        target: m.target ?? null,
        unit: m.unit ?? null,
        cadence: m.cadence ?? null,
        attribution_rules: m.attribution_rules ?? {},
        data_sources: m.data_sources ?? [],
        required_capabilities: m.required_capabilities ?? [],
      });
    }

    await supabase.from("okr_node_events").insert({
      tenant_id: tenant!.id,
      okr_node_id: ins.data.id,
      event_type: "ingested",
      payload: { client_id: n.client_id },
      actor,
    });
  }

  const response = { ok: true, tenant_id: tenant!.id, created, warnings };
  await storeIdempotency("okr_ingest", idemKey, tenant!.id, response);
  return json(response);
}

async function spawnSubOkr(req: Request, parentId: string, actor: string) {
  const body = await req.json();
  if (!body.title || !body.kind || !body.spawned_from_reason) {
    return json({ error: "title, kind, spawned_from_reason required" }, 400);
  }
  const { data: parent, error: pErr } = await supabase
    .from("okr_nodes")
    .select("*")
    .eq("id", parentId)
    .single();
  if (pErr || !parent) return json({ error: "parent not found" }, 404);

  const ins = await supabase
    .from("okr_nodes")
    .insert({
      tenant_id: parent.tenant_id,
      parent_id: parent.id,
      kind: body.kind,
      title: body.title,
      description: body.description ?? null,
      status: "draft",
      spawned_from_reason: body.spawned_from_reason,
      created_by: body.created_by ?? "human",
    })
    .select()
    .single();
  if (ins.error) return json({ error: ins.error.message }, 500);

  await supabase.from("okr_node_events").insert({
    tenant_id: parent.tenant_id,
    okr_node_id: ins.data.id,
    event_type: "spawned",
    payload: { parent_id: parent.id, reason: body.spawned_from_reason },
    actor,
  });
  return json({ ok: true, node: ins.data });
}

async function supersedeOkr(req: Request, oldId: string, actor: string) {
  const body = await req.json();
  if (!body.title || !body.reason) return json({ error: "title and reason required" }, 400);
  const { data: old, error: oErr } = await supabase
    .from("okr_nodes")
    .select("*")
    .eq("id", oldId)
    .single();
  if (oErr || !old) return json({ error: "node not found" }, 404);

  const ins = await supabase
    .from("okr_nodes")
    .insert({
      tenant_id: old.tenant_id,
      parent_id: old.parent_id,
      kind: old.kind,
      title: body.title,
      description: body.description ?? old.description,
      status: "active",
      version: old.version + 1,
      spawned_from_reason: body.reason,
      created_by: body.created_by ?? "human",
    })
    .select()
    .single();
  if (ins.error) return json({ error: ins.error.message }, 500);

  await supabase
    .from("okr_nodes")
    .update({ status: "superseded", superseded_by: ins.data.id, updated_at: new Date().toISOString() })
    .eq("id", oldId);

  await supabase.from("okr_node_events").insert([
    {
      tenant_id: old.tenant_id,
      okr_node_id: oldId,
      event_type: "superseded",
      payload: { superseded_by: ins.data.id, reason: body.reason },
      actor,
    },
    {
      tenant_id: old.tenant_id,
      okr_node_id: ins.data.id,
      event_type: "created",
      payload: { supersedes: oldId },
      actor,
    },
  ]);

  return json({ ok: true, node: ins.data });
}

async function getTree(url: URL) {
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId) return json({ error: "tenant_id required" }, 400);
  const { data: nodes, error } = await supabase
    .from("okr_nodes")
    .select("*, okr_measurements(*)")
    .eq("tenant_id", tenantId)
    .order("created_at");
  if (error) return json({ error: error.message }, 500);
  return json({ nodes });
}

// ---------- router ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  // Strip the function name prefix: /awip-api/...
  const path = url.pathname.replace(/^.*\/awip-api/, "") || "/";

  try {
    // Public-ish: allow GET /capabilities with service token OR operator JWT (still requires auth)
    const auth = await authorize(req);
    if (!auth.ok) return json({ error: auth.error ?? "unauthorized" }, 401);

    if (req.method === "GET" && path === "/capabilities") return await listCapabilities(url);
    if (req.method === "POST" && path === "/capabilities/register") return await registerCapability(req, auth.actor);
    if (req.method === "POST" && path === "/okr/ingest") return await ingestOkrTree(req, auth.actor);
    if (req.method === "GET" && path === "/okr/tree") return await getTree(url);

    const spawnMatch = path.match(/^\/okr\/([0-9a-f-]+)\/spawn$/i);
    if (req.method === "POST" && spawnMatch) return await spawnSubOkr(req, spawnMatch[1], auth.actor);
    const supMatch = path.match(/^\/okr\/([0-9a-f-]+)\/supersede$/i);
    if (req.method === "POST" && supMatch) return await supersedeOkr(req, supMatch[1], auth.actor);

    return json({ error: "not found", path }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
