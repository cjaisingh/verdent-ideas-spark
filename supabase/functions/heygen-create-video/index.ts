// Create a HeyGen video for an operator. Free-plan tier: 3/month, ≤60s each.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Stock defaults (Madison, landscape) — swap by editing constants.
const DEFAULT_AVATAR_ID = "a9a39532d1834ee6aab8202d8deb9251";
const DEFAULT_VOICE_ID = "9e832936642b4277b639f283915a77e6";

const AWIP_PITCH_SCRIPT =
  "AWIP Core is the operator console and capability registry behind every AWIP module. " +
  "It's substrate, not a brain. Core records OKRs, tracks each module's capability manifest, " +
  "and emits an event for every change. It doesn't decide who acts when. " +
  "That keeps modules decoupled and lets each one ship at its own pace, " +
  "while operators get a single source of truth for objectives, capabilities, and audit trails. " +
  "If you're building autonomous workflows, AWIP Core gives you the ground floor: " +
  "contract API, idempotent writes, role-gated access, and an event log you can replay. " +
  "Modules plug in. Operators stay in control.";

Deno.serve(withLogger("heygen-create-video", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const HEYGEN_API_KEY = Deno.env.get("HEYGEN_API_KEY");
  if (!HEYGEN_API_KEY) return json({ error: "missing_heygen_api_key" }, 500);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verify caller via JWT and check role.
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
  const { data: isOp } = await userClient.rpc("has_role", { _user_id: u.user.id, _role: "operator" });
  const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isOp && !isAdmin) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const kind = String(body.kind ?? "");
  if (kind !== "quarterly_recap" && kind !== "external_pitch") {
    return json({ error: "invalid_kind" }, 400);
  }
  const titleIn = typeof body.title === "string" ? body.title.trim() : "";
  const subjectKind = typeof body.subject_kind === "string" ? body.subject_kind : null;
  const subjectRef = typeof body.subject_ref === "string" ? body.subject_ref : null;
  const overrideScript = typeof body.script === "string" ? body.script.trim() : "";

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Quota check (soft).
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await sb.from("heygen_videos").select("id", { count: "exact", head: true })
    .gte("created_at", monthStart.toISOString());
  if ((count ?? 0) >= 3) {
    return json({ error: "monthly_quota_reached", used: count, quota: 3 }, 429);
  }

  // Build script.
  let script = overrideScript;
  if (!script) {
    if (kind === "external_pitch") {
      script = AWIP_PITCH_SCRIPT;
    } else {
      // Quarterly recap: pull most recent quarterly action and summarise via Lovable AI.
      const { data: act } = await sb.from("discussion_actions")
        .select("id,title,description,short_num,created_at")
        .ilike("title", "%quarterly review%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const seed = act
        ? `Action #${act.short_num}: ${act.title}\n\n${act.description ?? ""}`
        : "No quarterly review action found yet.";
      script = await synthesiseRecap(seed);
    }
  }
  if (script.length > 1500) script = script.slice(0, 1500);

  const title = titleIn || (kind === "quarterly_recap" ? "Quarterly recap" : "AWIP external pitch");

  // Insert queued row.
  const { data: row, error: insErr } = await sb.from("heygen_videos").insert({
    kind, title, script, status: "queued",
    requested_by: u.user.id,
    subject_kind: subjectKind, subject_ref: subjectRef,
  }).select("*").single();
  if (insErr || !row) return json({ error: "insert_failed", detail: insErr?.message }, 500);

  // Call HeyGen v2/video/generate.
  const hgPayload = {
    video_inputs: [{
      character: { type: "avatar", avatar_id: DEFAULT_AVATAR_ID, avatar_style: "normal" },
      voice: { type: "text", input_text: script, voice_id: DEFAULT_VOICE_ID },
    }],
    dimension: { width: 1280, height: 720 },
  };

  const hgRes = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "X-Api-Key": HEYGEN_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(hgPayload),
  });
  const hgJson = await hgRes.json().catch(() => ({}));

  if (!hgRes.ok || hgJson?.error) {
    const errMsg = hgJson?.error?.message || hgJson?.message || `HeyGen ${hgRes.status}`;
    await sb.from("heygen_videos").update({ status: "failed", error: errMsg }).eq("id", row.id);
    return json({ error: "heygen_create_failed", detail: errMsg, status: hgRes.status }, 502);
  }

  const heygenVideoId = hgJson?.data?.video_id ?? null;
  await sb.from("heygen_videos").update({
    status: "processing",
    heygen_video_id: heygenVideoId,
  }).eq("id", row.id);

  return json({ ok: true, id: row.id, heygen_video_id: heygenVideoId });
}));

async function synthesiseRecap(seed: string): Promise<string> {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) {
    return "Quarterly review summary unavailable — operator API key missing. " +
      "Open the action in the AWIP console for the full text.";
  }
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content:
            "You write 60-second video narrations (~150 words). Plain spoken English. No bullet points. " +
            "Open with the quarter, give 3 wins, 1 risk, 1 next step. Confident, calm tone." },
          { role: "user", content: seed },
        ],
      }),
    });
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content?.trim();
    return text || "Quarterly recap could not be synthesised; please review the action directly.";
  } catch (e) {
    return `Recap synthesis failed: ${(e as Error).message}. Open the quarterly action for details.`;
  }
}
