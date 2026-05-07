// Operator-only DB Explorer proxy.
// Verifies the caller has the `operator` role using their JWT, then invokes
// the locked-down SECURITY DEFINER RPCs (db_list_tables / db_list_columns /
// db_preview_rows) using the service role. The RPCs themselves have EXECUTE
// revoked from anon/authenticated, so this edge function is the only path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "missing_bearer" });

  // Verify the caller and check operator role under their JWT (RLS-safe).
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json(401, { error: "invalid_token" });

  const { data: isOp, error: roleErr } = await userClient.rpc("has_role", {
    _user_id: userRes.user.id,
    _role: "operator",
  } as never);
  if (roleErr || !isOp) return json(403, { error: "operator_required" });

  let body: { action?: string; table?: string; limit?: number; offset?: number };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  // Service-role client to call the locked-down RPCs.
  const svc = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false },
  });

  switch (body.action) {
    case "list_tables": {
      const { data, error } = await svc.rpc("db_list_tables");
      if (error) return json(500, { error: error.message });
      return json(200, { data });
    }
    case "list_columns": {
      if (!body.table) return json(400, { error: "table_required" });
      const { data, error } = await svc.rpc("db_list_columns", {
        _table: body.table,
      } as never);
      if (error) return json(500, { error: error.message });
      return json(200, { data });
    }
    case "preview_rows": {
      if (!body.table) return json(400, { error: "table_required" });
      const { data, error } = await svc.rpc("db_preview_rows", {
        _table: body.table,
        _limit: body.limit ?? 50,
        _offset: body.offset ?? 0,
      } as never);
      if (error) return json(500, { error: error.message });
      return json(200, { data });
    }
    case "list_all_columns": {
      const { data, error } = await svc.rpc("db_list_all_columns");
      if (error) return json(500, { error: error.message });
      return json(200, { data });
    }
    case "refresh_counts": {
      const { error: aErr } = await svc.rpc("db_analyze_public");
      if (aErr) return json(500, { error: aErr.message });
      const { data, error } = await svc.rpc("db_list_tables");
      if (error) return json(500, { error: error.message });
      return json(200, { data });
    }
    default:
      return json(400, { error: "unknown_action" });
  }
});
