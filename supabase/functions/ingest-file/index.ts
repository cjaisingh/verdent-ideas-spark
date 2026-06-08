// W9.0 — ingest-file
// Operator (or service token) registers a file already uploaded to the
// `ingested-files` storage bucket. Dedupes by (engagement_id, sha256),
// classifies CAD/FM vs markitdown-supported MIMEs, writes the row,
// and emits the `uploaded` event. Sidecar/GHA worker picks it up next.
//
// Contract: supabase/functions/_shared/contracts/ingest-file.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import {
  IngestFileBody,
  isCadFmExtension,
  isMarkitdownSupported,
  type IngestFileResponse,
  type IngestStatus,
} from "../_shared/contracts/ingest-file.ts";

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

Deno.serve(withLogger("ingest-file", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

  let uploadedBy: string | null = null;
  if (!isService) {
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
    uploadedBy = u.user.id;
    const { data: isOp } = await userClient.rpc("has_role", { _user_id: uploadedBy, _role: "operator" });
    const { data: isAd } = await userClient.rpc("has_role", { _user_id: uploadedBy, _role: "admin" });
    if (!isOp && !isAd) return json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = IngestFileBody.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Dedupe: same (engagement_id, sha256) → return existing.
  const { data: existing } = await sb
    .from("ingested_files")
    .select("id, status, parser")
    .eq("engagement_id", p.engagement_id)
    .eq("sha256", p.sha256)
    .maybeSingle();

  if (existing) {
    return json<IngestFileResponse>({
      file_id: existing.id,
      status: existing.status as IngestStatus,
      parser: existing.parser,
      deduped: true,
      route: "duplicate",
    });
  }

  // Classify route.
  const cadFm = isCadFmExtension(p.filename);
  let route: IngestFileResponse["route"];
  let status: IngestStatus;
  let parser: string | null = null;

  if (p.force_route) {
    route = p.force_route;
    status = route === "metadata_only" ? "metadata_only" : "pending";
    parser = route === "metadata_only" ? "metadata_only" : null;
  } else if (cadFm) {
    route = "metadata_only";
    status = "metadata_only";
    parser = "metadata_only";
  } else if (!isMarkitdownSupported(p.mime)) {
    route = "metadata_only";
    status = "metadata_only";
    parser = "metadata_only";
  } else if (p.size_bytes > 25 * 1024 * 1024) {
    // Big files → batch through GHA worker overnight.
    route = "gha-bulk";
    status = "pending";
  } else {
    route = "sidecar";
    status = "pending";
  }

  const { data: inserted, error: insErr } = await sb
    .from("ingested_files")
    .insert({
      engagement_id: p.engagement_id,
      domain_id: p.domain_id ?? null,
      storage_path: p.storage_path,
      filename: p.filename,
      mime: p.mime,
      size_bytes: p.size_bytes,
      sha256: p.sha256,
      source: p.source,
      status,
      parser,
      cad_fm: cadFm,
      declared_discipline: p.declared_discipline ?? null,
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return json({ error: "insert_failed", detail: insErr?.message }, 500);
  }

  await sb.from("ingested_file_events").insert({
    file_id: inserted.id,
    event_type: status === "metadata_only" ? "metadata_only" : "uploaded",
    actor: isService ? "service" : "operator",
    payload: { route, mime: p.mime, size_bytes: p.size_bytes, cad_fm: cadFm },
  });

  return json<IngestFileResponse>({
    file_id: inserted.id,
    status,
    parser,
    deduped: false,
    route,
  });
}));
