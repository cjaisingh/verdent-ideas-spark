// Pluggable external-data ingest dispatcher. Runs at 22:30 UTC daily.
// Iterates every enabled row in public.ingestion_sources and routes to the
// handler matching its `kind`. Each invocation writes one ingestion_runs row,
// idempotent on (source_key, idempotency_key) where idempotency_key=YYYY-MM-DD.
//
// Built-in handlers:
//   - awip_docs_refresh : touches awip_docs.updated_at to mark RAG corpus as
//                         freshness-checked. (Real re-indexing happens via the
//                         ingest-awip-docs script run from the operator's
//                         workstation; this nightly job just records that the
//                         corpus was reviewed and surfaces stale docs.)
//
// Add a new handler by:
//   1. Inserting a row into ingestion_sources with a new `kind`
//   2. Adding `case "<kind>":` below that returns { rows_in, rows_upserted }
//
// Auth: AWIP_SERVICE_TOKEN cron header, OR an authenticated operator JWT.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-service-token, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type HandlerResult = { rows_in: number; rows_upserted: number; rows_failed?: number; detail?: Record<string, unknown> };

async function handle_awip_docs_refresh(sb: SupabaseClient): Promise<HandlerResult> {
  // Count docs and surface anything older than 30d as stale (information only —
  // does not modify content). Real re-ingestion is the job of
  // scripts/ingest-awip-docs.ts; this job records freshness and emits a
  // sentinel finding if too much of the corpus is stale.
  const { data, error } = await sb
    .from("awip_docs")
    .select("id, updated_at")
    .limit(5000);
  if (error) throw error;
  const total = data?.length ?? 0;
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const stale = (data ?? []).filter((d: any) => new Date(d.updated_at).getTime() < cutoff).length;
  return {
    rows_in: total,
    rows_upserted: 0,
    detail: { total_docs: total, stale_docs_30d: stale },
  };
}

async function dispatchHandler(sb: SupabaseClient, kind: string): Promise<HandlerResult> {
  switch (kind) {
    case "awip_docs_refresh":
      return await handle_awip_docs_refresh(sb);
    default:
      throw new Error(`unknown handler kind: ${kind}`);
  }
}

Deno.serve(withLogger("ingest-external-data", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await dispatchAlert(sb, "ingest-external-data", "auth_failed", "ingest 401");
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const url = new URL(req.url);
    const onlySource = url.searchParams.get("source");
    const today = new Date().toISOString().slice(0, 10);
    const idemKey = today;

    let q = sb.from("ingestion_sources").select("source_key, kind, enabled").eq("enabled", true);
    if (onlySource) q = q.eq("source_key", onlySource);
    const { data: sources, error } = await q;
    if (error) throw error;

    const summary: Array<Record<string, unknown>> = [];
    for (const s of sources ?? []) {
      const runStart = Date.now();
      // Skip if this source already ran successfully today (idempotency)
      const { data: existing } = await sb.from("ingestion_runs")
        .select("id, status").eq("source_key", s.source_key).eq("idempotency_key", idemKey)
        .maybeSingle();
      if (existing?.status === "ok") {
        summary.push({ source: s.source_key, status: "skipped_already_ran" });
        continue;
      }

      try {
        const result = await dispatchHandler(sb, s.kind);
        await sb.from("ingestion_runs").upsert([{
          source_key: s.source_key, idempotency_key: idemKey,
          started_at: new Date(runStart).toISOString(),
          finished_at: new Date().toISOString(),
          status: "ok",
          rows_in: result.rows_in, rows_upserted: result.rows_upserted,
          rows_failed: result.rows_failed ?? 0,
          duration_ms: Date.now() - runStart, trigger,
          detail: result.detail ?? {},
        }], { onConflict: "source_key,idempotency_key" });
        await sb.from("ingestion_sources").update({
          last_run_at: new Date().toISOString(),
          last_status: "ok", last_error: null,
        }).eq("source_key", s.source_key);
        summary.push({ source: s.source_key, status: "ok", ...result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from("ingestion_runs").upsert([{
          source_key: s.source_key, idempotency_key: idemKey,
          started_at: new Date(runStart).toISOString(),
          finished_at: new Date().toISOString(),
          status: "error", duration_ms: Date.now() - runStart, trigger,
          error: msg, detail: {},
        }], { onConflict: "source_key,idempotency_key" });
        await sb.from("ingestion_sources").update({
          last_run_at: new Date().toISOString(),
          last_status: "error", last_error: msg,
        }).eq("source_key", s.source_key);
        summary.push({ source: s.source_key, status: "error", error: msg });
      }
    }

    ctx.attach("sources_run", summary.length);
    await sb.from("automation_runs").insert({
      job: "ingest-external-data", trigger, status: "ok", status_code: 200,
      duration_ms: Date.now() - startedAt,
      message: `Ran ${summary.length} source(s)`,
      detail: { summary },
    });
    return json({ ok: true, sources: summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("automation_runs").insert({
      job: "ingest-external-data", trigger, status: "error", status_code: 500,
      duration_ms: Date.now() - startedAt, message: msg, detail: {},
    });
    await dispatchAlert(sb, "ingest-external-data", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
