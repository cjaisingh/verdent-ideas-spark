// W7.2 — claims ingest endpoint.
// Operator JWT or service token can file a claim; supersedes auto-voids the
// previous claim via trigger. Returns the freshly-resolved winner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const Body = z.object({
  entity: z.string().min(1).max(64),
  entity_id: z.string().uuid(),
  field: z.string().min(1).max(128).default("*"),
  source: z.string().min(1).max(32),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).default(1.0),
  evidence_ref: z.record(z.unknown()).default({}),
  supersedes_id: z.string().uuid().nullable().optional(),
  valid_from: z.string().datetime().optional(),
  valid_to: z.string().datetime().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  claimed_by_label: z.string().max(120).nullable().optional(),
});

Deno.serve(withLogger("claims-ingest", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

  // Resolve actor
  let actorId: string | null = null;
  let actorLabel = "system";
  if (!isService) {
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
    actorId = u.user.id;
    actorLabel = u.user.email ?? "operator";
    // Confirm operator/admin via RPC against has_role
    const { data: isOp } = await userClient.rpc("has_role", { _user_id: actorId, _role: "operator" });
    const { data: isAd } = await userClient.rpc("has_role", { _user_id: actorId, _role: "admin" });
    if (!isOp && !isAd) return json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: inserted, error } = await sb.from("claims").insert({
    entity: p.entity,
    entity_id: p.entity_id,
    field: p.field,
    source: p.source,
    value: p.value as never,
    confidence: p.confidence,
    evidence_ref: p.evidence_ref,
    supersedes_id: p.supersedes_id ?? null,
    valid_from: p.valid_from ?? new Date().toISOString(),
    valid_to: p.valid_to ?? null,
    note: p.note ?? null,
    claimed_by: actorId,
    claimed_by_label: p.claimed_by_label ?? actorLabel,
  }).select("id").single();
  if (error) return json({ error: error.message }, 500);

  // Resolve truth as the same actor (RPC requires operator/admin).
  // For service-token callers, skip resolve (they can call RPC themselves).
  let resolved: unknown = null;
  if (!isService) {
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: r } = await userClient.rpc("resolve_truth", {
      _entity: p.entity, _entity_id: p.entity_id, _field: p.field,
    });
    resolved = r;
  }

  return json({ ok: true, claim_id: inserted.id, resolved });
}));
