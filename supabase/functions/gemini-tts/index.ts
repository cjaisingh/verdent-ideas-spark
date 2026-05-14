// Gemini TTS proxy. Operator JWT only. Returns audio/wav (24kHz PCM).
// Uses GOOGLE_AI_API_KEY (direct Google AI Studio key, not via Lovable Gateway —
// Gemini TTS models are not exposed through the gateway).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/ai-usage.ts";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_VOICES = new Set([
  "Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr",
]);
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
]);

// 24kHz mono 16-bit PCM → WAV wrapper so iOS/browsers play it directly.
function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const numChannels = 1, bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buf);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  w(36, "data"); view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

Deno.serve(withLogger("gemini-tts", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr || !u.user) return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  // Slice 4: default-deny allowlist (rork). Email is the principal.
  {
    const sbAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const principal = u.user.email ?? u.user.id;
    const { data: allowed } = await sbAdmin.rpc("is_principal_allowed", {
      _platform: "rork",
      _principal: principal,
    });
    if (allowed !== true) {
      ctx.attach("__classified_error", "allowlist_reject");
      return new Response(JSON.stringify({ error: "not_allowlisted" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }


  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "google_ai_key_missing" }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  let body: { text?: string; voice?: string; model?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const text = (body.text ?? "").trim();
  if (!text) return new Response(JSON.stringify({ error: "text_required" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (text.length > 5000) return new Response(JSON.stringify({ error: "text_too_long", limit: 5000 }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  const voice = ALLOWED_VOICES.has(body.voice ?? "") ? body.voice! : "Kore";
  const model = ALLOWED_MODELS.has(body.model ?? "") ? body.model! : "gemini-2.5-flash-preview-tts";

  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE, { auth: { persistSession: false } });

  const start = Date.now();
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    },
  );

  if (!upstream.ok) {
    const errTxt = await upstream.text().catch(() => "");
    await logAiUsage(admin, {
      job: "gemini-tts", model, trigger: "user",
      status: "error", status_code: upstream.status, latency_ms: Date.now() - start,
      error: errTxt.slice(0, 500), request_ref: { user_id: u.user.id, voice, chars: text.length },
    });
    const status = upstream.status === 429 ? 429 : (upstream.status === 401 || upstream.status === 403 ? 502 : 502);
    return new Response(JSON.stringify({
      error: "tts_upstream_error", status: upstream.status, detail: errTxt.slice(0, 500),
    }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const json = await upstream.json();
  const b64 = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) {
    await logAiUsage(admin, {
      job: "gemini-tts", model, trigger: "user",
      status: "error", status_code: 502, latency_ms: Date.now() - start,
      error: "no_audio_in_response", request_ref: { user_id: u.user.id, voice, chars: text.length },
    });
    return new Response(JSON.stringify({ error: "no_audio_in_response" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const pcm = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const wav = pcmToWav(pcm, 24000);
  const audioSeconds = pcm.byteLength / (24000 * 2);

  await logAiUsage(admin, {
    job: "gemini-tts", model, trigger: "user",
    status: "ok", status_code: 200, latency_ms: Date.now() - start,
    prompt_tokens: Math.ceil(text.length / 4),
    completion_tokens: Math.ceil(audioSeconds), // ~1 token per audio second for cost approximation
    request_ref: { user_id: u.user.id, voice, chars: text.length, audio_seconds: Math.round(audioSeconds * 10) / 10 },
  });

  return new Response(wav, {
    headers: {
      ...corsHeaders,
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      "X-Gemini-Voice": voice,
      "X-Gemini-Model": model,
      "X-Audio-Seconds": String(Math.round(audioSeconds * 10) / 10),
    },
  });
}));
