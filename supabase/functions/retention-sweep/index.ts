// Nightly retention sweep — calls public.purge_expired_rows() to delete rows older than
// each table's retention_settings.retention_days. Auth: AWIP_SERVICE_TOKEN (cron).
//
// Runs daily at 03:30 UTC via pg_cron (see migration). Idempotent — re-running mid-day
// just deletes anything that became expired since the last sweep (typically 0 rows).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-awip-service-token, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(withLogger("retention-sweep", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const token = req.headers.get("x-awip-service-token");
  if (!SERVICE_TOKEN || token !== SERVICE_TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("purge_expired_rows", { _table: null });

  if (error) {
    ctx.attach("rpc_error", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const rows = (data ?? []) as Array<{ table_name: string; deleted: number }>;
  const total = rows.reduce((acc, r) => acc + Number(r.deleted ?? 0), 0);
  ctx.attach("tables_swept", rows.length);
  ctx.attach("rows_deleted", total);

  return new Response(JSON.stringify({ ok: true, total_deleted: total, per_table: rows }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
}));
