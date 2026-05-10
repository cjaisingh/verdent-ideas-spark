// Quarterly Review opener.
//
// Auth: x-awip-service-token (cron) or operator JWT (manual).
// POST /  → idempotent insert of one discussion_action per (year, quarter).
// GET  /  → status: which quarter we're in + whether today's action exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-awip-service-token, x-service-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// Fixed namespace UUID so each (year, quarter) maps deterministically to the same subject_id.
// This gives us idempotency without a separate unique constraint.
const NAMESPACE = "8e5f3a2c-7b91-4d6e-a0f8-1c2d3e4f5a6b";

async function quarterSubjectId(year: number, quarter: number): Promise<string> {
  const data = new TextEncoder().encode(`${NAMESPACE}|quarterly-review|${year}|Q${quarter}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const b = new Uint8Array(hash);
  // Format first 16 bytes as a UUID v4-ish string (deterministic, not RFC4122-strict but fine for our key).
  const hex = Array.from(b.slice(0, 16))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function currentQuarter(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1; // 1-4
  return { year, quarter };
}

async function isAuthorized(req: Request): Promise<boolean> {
  const svc = req.headers.get("x-awip-service-token") ?? req.headers.get("x-service-token");
  if (svc && SERVICE_TOKEN && svc === SERVICE_TOKEN) return true;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  return !!roles?.some((r) => r.role === "operator" || r.role === "admin");
}

async function openQuarterlyReview() {
  const { year, quarter } = currentQuarter();
  const subjectId = await quarterSubjectId(year, quarter);

  // Idempotent: skip if a row already exists for this quarter.
  const { data: existing } = await admin
    .from("discussion_actions")
    .select("id, short_num, status")
    .eq("subject_type", "quarterly_review")
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (existing) {
    return { skipped: true, year, quarter, action_id: existing.id, short_num: existing.short_num };
  }

  const dueAt = new Date();
  dueAt.setUTCDate(dueAt.getUTCDate() + 14);

  const { data, error } = await admin
    .from("discussion_actions")
    .insert({
      subject_type: "quarterly_review",
      subject_id: subjectId,
      title: `Quarterly review — Q${quarter} ${year}`,
      details:
        `Run the checklist in docs/quarterly-review.md.\n\n` +
        `Cadence: scaffold configs, Tailwind drift, Dependabot majors, edge function inventory, cron inventory, mem:// sweep, ADRs, secrets rotation, sidebar IA, RLS coverage.\n\n` +
        `Target completion: ${dueAt.toISOString().slice(0, 10)} (14 days).`,
      status: "open",
      priority: "med",
      owner: "operator",
      due_at: dueAt.toISOString(),
      source: "manual",
      night_eligible: false,
    })
    .select("id, short_num")
    .single();

  if (error) throw error;
  return { skipped: false, year, quarter, action_id: data.id, short_num: data.short_num };
}

const handler = withLogger("quarterly-review-open", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const { year, quarter } = currentQuarter();

  if (req.method === "GET") {
    if (!(await isAuthorized(req))) return json({ error: "unauthorized" }, 401);
    const subjectId = await quarterSubjectId(year, quarter);
    const { data } = await admin
      .from("discussion_actions")
      .select("id, short_num, status, created_at")
      .eq("subject_type", "quarterly_review")
      .eq("subject_id", subjectId)
      .maybeSingle();
    return json({ year, quarter, action: data ?? null });
  }

  if (req.method === "POST") {
    if (!(await isAuthorized(req))) return json({ error: "unauthorized" }, 401);
    try {
      const result = await openQuarterlyReview();
      return json(result);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  return json({ error: "method not allowed" }, 405);
});

Deno.serve(handler);
