// Module-side register edge function. Drop into supabase/functions/register/index.ts
// of each module project. Reads the bundled capabilities.json and forwards every entry
// to Core's /capabilities/register endpoint using the shared service token.

import capabilitiesManifest from "../../../capabilities.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const coreUrl = Deno.env.get("AWIP_CORE_URL");
  const serviceToken = Deno.env.get("AWIP_SERVICE_TOKEN");
  if (!coreUrl || !serviceToken) {
    return json({ error: "AWIP_CORE_URL or AWIP_SERVICE_TOKEN not configured" }, 500);
  }

  const m = capabilitiesManifest as {
    module: string;
    capabilities: Array<Record<string, unknown>>;
  };

  const results: Array<{ id: string; status: number; body: unknown }> = [];
  for (const cap of m.capabilities) {
    const r = await fetch(`${coreUrl}/functions/v1/awip-api/capabilities/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-awip-service-token": serviceToken,
      },
      body: JSON.stringify({ ...cap, owning_module: m.module }),
    });
    const body = await r.json().catch(() => null);
    results.push({ id: String(cap.id), status: r.status, body });
  }

  const ok = results.every((r) => r.status >= 200 && r.status < 300);
  return json({ module: m.module, ok, results }, ok ? 200 : 502);
});
