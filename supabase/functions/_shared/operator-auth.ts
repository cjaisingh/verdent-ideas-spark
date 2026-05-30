// Shared operator-role check for cron/edge functions that accept either a
// service-token (cron) or an operator/admin Bearer JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type OperatorAuthResult =
  | { ok: true; triggeredByCron: boolean; userId: string | null }
  | { ok: false; status: 401 | 403; error: string };

export async function requireCronOrOperator(req: Request): Promise<OperatorAuthResult> {
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
  const provided =
    req.headers.get("x-awip-service-token") ?? req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (triggeredByCron) return { ok: true, triggeredByCron: true, userId: null };

  if (!auth.startsWith("Bearer ")) return { ok: false, status: 401, error: "unauthorized" };

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return { ok: false, status: 401, error: "unauthorized" };

  const [{ data: isOp }, { data: isAdmin }] = await Promise.all([
    userClient.rpc("has_role", { _user_id: u.user.id, _role: "operator" }),
    userClient.rpc("has_role", { _user_id: u.user.id, _role: "admin" }),
  ]);
  if (!isOp && !isAdmin) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, triggeredByCron: false, userId: u.user.id };
}
