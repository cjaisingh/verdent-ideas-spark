// Shared config, constants, types, and HTTP helpers for the night-agent function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export const MAX_JOBS_PER_SHIFT = 50;

export type NightSettings = {
  night_agent_enabled?: boolean | null;
  night_timezone?: string | null;
  night_window_start?: string | null;
  night_window_end?: string | null;
  night_blackout_dates?: unknown;
  night_allowed_kinds?: unknown;
} | null;

export type SbClient = ReturnType<typeof createClient>;

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createServiceClient(): SbClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE);
}
