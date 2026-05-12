// GET / POST  -> { linked, directory, fetched_at }
// Operator JWT only. Read-only.
//
// "linked" = connector API keys we can actually see in Deno.env (i.e. linked
//   to this project). For each we hit the gateway's /api/v1/verify_credentials
//   so the operator gets a real health signal.
// "directory" = curated list of known gateway-enabled connectors so the page
//   can show "available but not linked" rows that link out to Cloud →
//   Connectors. The Lovable workspace inventory is not exposed at runtime, so
//   we can't enumerate every available connection from here.
//
// Optional ?probe=<env_var_name> re-runs verify for one connection only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";

// Probe cadence: every 30 min via scheduled-connections-probe cron.
const PROBE_INTERVAL_MS = 30 * 60 * 1000;

function nextRunAt(): string {
  const now = Date.now();
  const next = Math.ceil(now / PROBE_INTERVAL_MS) * PROBE_INTERVAL_MS;
  return new Date(next).toISOString();
}

async function authorize(req: Request): Promise<{ uid: string; service: boolean } | null> {
  const svc = req.headers.get("x-awip-service-token");
  if (svc && SERVICE_TOKEN && svc === SERVICE_TOKEN) {
    return { uid: "00000000-0000-0000-0000-000000000000", service: true };
  }
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles?.some((r) => r.role === "operator" || r.role === "admin")) return null;
  return { uid: data.user.id, service: false };
}

// Curated directory of gateway-enabled connectors. Keep in sync with the
// connector list shown in the agent's standard_connectors knowledge file.
type Entry = {
  connector_id: string;
  name: string;
  uses_gateway: boolean;
  env_var_name: string; // expected runtime secret name when linked
  category: "messaging" | "email" | "docs" | "data" | "ai" | "dev" | "other";
};

const DIRECTORY: Entry[] = [
  { connector_id: "telegram", name: "Telegram", uses_gateway: true, env_var_name: "TELEGRAM_API_KEY", category: "messaging" },
  { connector_id: "slack", name: "Slack", uses_gateway: true, env_var_name: "SLACK_API_KEY", category: "messaging" },
  { connector_id: "microsoft_teams", name: "Microsoft Teams", uses_gateway: true, env_var_name: "MICROSOFT_TEAMS_API_KEY", category: "messaging" },
  { connector_id: "google_mail", name: "Gmail", uses_gateway: true, env_var_name: "GOOGLE_MAIL_API_KEY", category: "email" },
  { connector_id: "microsoft_outlook", name: "Outlook", uses_gateway: true, env_var_name: "MICROSOFT_OUTLOOK_API_KEY", category: "email" },
  { connector_id: "resend", name: "Resend", uses_gateway: true, env_var_name: "RESEND_API_KEY", category: "email" },
  { connector_id: "mailgun", name: "Mailgun", uses_gateway: true, env_var_name: "MAILGUN_API_KEY", category: "email" },
  { connector_id: "brevo", name: "Brevo", uses_gateway: true, env_var_name: "BREVO_API_KEY", category: "email" },
  { connector_id: "google_drive", name: "Google Drive", uses_gateway: true, env_var_name: "GOOGLE_DRIVE_API_KEY", category: "docs" },
  { connector_id: "google_docs", name: "Google Docs", uses_gateway: true, env_var_name: "GOOGLE_DOCS_API_KEY", category: "docs" },
  { connector_id: "google_sheets", name: "Google Sheets", uses_gateway: true, env_var_name: "GOOGLE_SHEETS_API_KEY", category: "docs" },
  { connector_id: "google_slides", name: "Google Slides", uses_gateway: true, env_var_name: "GOOGLE_SLIDES_API_KEY", category: "docs" },
  { connector_id: "google_calendar", name: "Google Calendar", uses_gateway: true, env_var_name: "GOOGLE_CALENDAR_API_KEY", category: "docs" },
  { connector_id: "microsoft_word", name: "Microsoft Word", uses_gateway: true, env_var_name: "MICROSOFT_WORD_API_KEY", category: "docs" },
  { connector_id: "microsoft_excel", name: "Microsoft Excel", uses_gateway: true, env_var_name: "MICROSOFT_EXCEL_API_KEY", category: "docs" },
  { connector_id: "microsoft_powerpoint", name: "Microsoft PowerPoint", uses_gateway: true, env_var_name: "MICROSOFT_POWERPOINT_API_KEY", category: "docs" },
  { connector_id: "microsoft_onedrive", name: "OneDrive", uses_gateway: true, env_var_name: "MICROSOFT_ONEDRIVE_API_KEY", category: "docs" },
  { connector_id: "microsoft_onenote", name: "OneNote", uses_gateway: true, env_var_name: "MICROSOFT_ONENOTE_API_KEY", category: "docs" },
  { connector_id: "notion", name: "Notion", uses_gateway: true, env_var_name: "NOTION_API_KEY", category: "docs" },
  { connector_id: "airtable", name: "Airtable", uses_gateway: true, env_var_name: "AIRTABLE_API_KEY", category: "data" },
  { connector_id: "hubspot", name: "HubSpot", uses_gateway: true, env_var_name: "HUBSPOT_API_KEY", category: "data" },
  { connector_id: "linear", name: "Linear", uses_gateway: true, env_var_name: "LINEAR_API_KEY", category: "dev" },
  { connector_id: "asana", name: "Asana", uses_gateway: true, env_var_name: "ASANA_API_KEY", category: "dev" },
  { connector_id: "ashby", name: "Ashby", uses_gateway: true, env_var_name: "ASHBY_API_KEY", category: "dev" },
  { connector_id: "fireflies", name: "Fireflies", uses_gateway: true, env_var_name: "FIREFLIES_API_KEY", category: "other" },
  { connector_id: "granola", name: "Granola", uses_gateway: true, env_var_name: "GRANOLA_API_KEY", category: "other" },
  { connector_id: "attention", name: "Attention", uses_gateway: true, env_var_name: "ATTENTION_API_KEY", category: "other" },
  { connector_id: "twilio", name: "Twilio", uses_gateway: true, env_var_name: "TWILIO_API_KEY", category: "messaging" },
  { connector_id: "aws_s3", name: "AWS S3", uses_gateway: true, env_var_name: "AWS_S3_API_KEY", category: "data" },
  { connector_id: "bigquery", name: "BigQuery", uses_gateway: true, env_var_name: "BIGQUERY_API_KEY", category: "data" },
  { connector_id: "snowflake", name: "Snowflake", uses_gateway: true, env_var_name: "SNOWFLAKE_API_KEY", category: "data" },
  { connector_id: "databricks", name: "Databricks", uses_gateway: true, env_var_name: "DATABRICKS_API_KEY", category: "data" },
  { connector_id: "storyblok", name: "Storyblok", uses_gateway: true, env_var_name: "STORYBLOK_API_KEY", category: "docs" },
  { connector_id: "contentful", name: "Contentful", uses_gateway: true, env_var_name: "CONTENTFUL_API_KEY", category: "docs" },
  { connector_id: "wordpress_com", name: "WordPress.com", uses_gateway: true, env_var_name: "WORDPRESS_COM_API_KEY", category: "docs" },
  { connector_id: "twitch", name: "Twitch", uses_gateway: true, env_var_name: "TWITCH_API_KEY", category: "other" },
  { connector_id: "wiz", name: "Wiz", uses_gateway: true, env_var_name: "WIZ_API_KEY", category: "other" },
  { connector_id: "inngest", name: "Inngest", uses_gateway: true, env_var_name: "INNGEST_API_KEY", category: "dev" },
  { connector_id: "gemini_enterprise", name: "Gemini Enterprise", uses_gateway: true, env_var_name: "GEMINI_ENTERPRISE_API_KEY", category: "ai" },
  // direct-API connectors (no gateway, no verify probe)
  { connector_id: "perplexity", name: "Perplexity", uses_gateway: false, env_var_name: "PERPLEXITY_API_KEY", category: "ai" },
  { connector_id: "firecrawl", name: "Firecrawl", uses_gateway: false, env_var_name: "FIRECRAWL_API_KEY", category: "data" },
  { connector_id: "elevenlabs", name: "ElevenLabs", uses_gateway: false, env_var_name: "ELEVENLABS_API_KEY", category: "ai" },
  { connector_id: "aikido", name: "Aikido", uses_gateway: false, env_var_name: "AIKIDO_API_KEY", category: "other" },
];

// also surface non-connector secrets that are health-relevant
const EXTRA_RUNTIME_SECRETS: Array<{ key: string; name: string; purpose: string }> = [
  { key: "LOVABLE_API_KEY", name: "Lovable API key", purpose: "Connector gateway + Lovable AI" },
  { key: "AWIP_SERVICE_TOKEN", name: "AWIP service token", purpose: "Cron jobs + cross-project calls" },
  { key: "DEEPGRAM_API_KEY", name: "Deepgram", purpose: "Realtime mic transcription" },
  { key: "GOOGLE_AI_API_KEY", name: "Google AI Studio", purpose: "Gemini TTS" },
  { key: "GITHUB_REVIEWS_TOKEN", name: "GitHub reviews token", purpose: "AWIP weekly reviews pull" },
];

type Verify = {
  outcome: "verified" | "skipped" | "failed" | "unknown";
  latency_ms?: number;
  error?: string;
  scope_hint?: Record<string, unknown>;
};

async function verifyGateway(envVarName: string, lovableKey: string): Promise<Verify> {
  const apiKey = Deno.env.get(envVarName);
  if (!apiKey) return { outcome: "unknown", error: "no_secret_in_env" };
  const t0 = Date.now();
  try {
    const r = await fetch("https://connector-gateway.lovable.dev/api/v1/verify_credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": apiKey },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { outcome: "failed", latency_ms: Date.now() - t0, error: body?.message ?? `HTTP ${r.status}` };
    }
    return {
      outcome: (body?.outcome as Verify["outcome"]) ?? "unknown",
      latency_ms: typeof body?.latency_ms === "number" ? body.latency_ms : Date.now() - t0,
      error: body?.error,
    };
  } catch (e) {
    return { outcome: "failed", latency_ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

// Direct-API probes — cheapest "is the key valid?" call per provider.
async function verifyDirect(connectorId: string, envVarName: string): Promise<Verify> {
  const apiKey = Deno.env.get(envVarName);
  if (!apiKey) return { outcome: "unknown", error: "no_secret_in_env" };
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  try {
    if (connectorId === "perplexity") {
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sonar", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { outcome: "failed", latency_ms: elapsed(), error: body?.error?.message ?? `HTTP ${r.status}` };
      return { outcome: "verified", latency_ms: elapsed(), scope_hint: { model: body?.model } };
    }
    if (connectorId === "firecrawl") {
      const r = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { outcome: "failed", latency_ms: elapsed(), error: body?.error ?? `HTTP ${r.status}` };
      return { outcome: "verified", latency_ms: elapsed(), scope_hint: body?.data ?? body };
    }
    if (connectorId === "elevenlabs") {
      const r = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": apiKey } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { outcome: "failed", latency_ms: elapsed(), error: body?.detail?.message ?? `HTTP ${r.status}` };
      return { outcome: "verified", latency_ms: elapsed(), scope_hint: { tier: body?.subscription?.tier, character_count: body?.subscription?.character_count, character_limit: body?.subscription?.character_limit } };
    }
    if (connectorId === "aikido") {
      const r = await fetch("https://app.aikido.dev/api/public/v1/issues_count", { headers: { Authorization: `Bearer ${apiKey}` } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { outcome: "failed", latency_ms: elapsed(), error: body?.error ?? `HTTP ${r.status}` };
      return { outcome: "verified", latency_ms: elapsed(), scope_hint: body };
    }
    return { outcome: "skipped", error: "no_direct_probe_implemented" };
  } catch (e) {
    return { outcome: "failed", latency_ms: elapsed(), error: e instanceof Error ? e.message : String(e) };
  }
}

async function verifyEntry(entry: Entry, lovableKey: string): Promise<Verify> {
  return entry.uses_gateway ? verifyGateway(entry.env_var_name, lovableKey) : verifyDirect(entry.connector_id, entry.env_var_name);
}

async function persistResult(entry: Entry, verify: Verify, userId: string) {
  try {
    await admin.from("connection_test_results").upsert({
      env_var_name: entry.env_var_name,
      connector_id: entry.connector_id,
      outcome: verify.outcome,
      latency_ms: verify.latency_ms ?? null,
      error: verify.error ?? null,
      scope_hint: verify.scope_hint ?? null,
      tested_at: new Date().toISOString(),
      tested_by: userId,
    }, { onConflict: "env_var_name" });
  } catch { /* swallow */ }
}

Deno.serve(withLogger("connections-inventory", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const who = await authorize(req);
  if (!who) return json({ error: "unauthorized" }, 401);

  const lovable = Deno.env.get("LOVABLE_API_KEY") ?? "";

  const url = new URL(req.url);
  const probe = url.searchParams.get("probe");
  if (probe) {
    const entry = DIRECTORY.find((d) => d.env_var_name === probe);
    if (!entry) return json({ error: "unknown_connector" }, 400);
    const v = await verifyEntry(entry, lovable);
    await persistResult(entry, v, who.uid);
    return json({ env_var_name: probe, verify: v, fetched_at: new Date().toISOString() });
  }

  const linkedEntries = DIRECTORY.filter((d) => Boolean(Deno.env.get(d.env_var_name)));

  // Read cached last-known results so the page paints fast and persists across reloads.
  const { data: cached } = await admin
    .from("connection_test_results")
    .select("env_var_name,outcome,latency_ms,error,scope_hint,tested_at");
  const cacheByVar = new Map<string, { outcome: string; latency_ms: number | null; error: string | null; scope_hint: unknown; tested_at: string }>();
  for (const c of cached ?? []) cacheByVar.set(c.env_var_name as string, c as never);

  const linked = linkedEntries.map((d) => {
    const c = cacheByVar.get(d.env_var_name);
    const verify: Verify = c
      ? { outcome: c.outcome as Verify["outcome"], latency_ms: c.latency_ms ?? undefined, error: c.error ?? undefined, scope_hint: (c.scope_hint as Record<string, unknown>) ?? undefined }
      : { outcome: "unknown" };
    return { ...d, linked: true, verify, tested_at: c?.tested_at ?? null };
  });

  const linkedSet = new Set(linkedEntries.map((d) => d.connector_id));
  const directory = DIRECTORY.map((d) => ({ ...d, linked: linkedSet.has(d.connector_id) }));
  const extras = EXTRA_RUNTIME_SECRETS.map((e) => ({ ...e, present: Boolean(Deno.env.get(e.key)) }));

  return json({ linked, directory, extras, fetched_at: new Date().toISOString() });
}));

