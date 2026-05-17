// codemod-any-enqueue
//
// Accepts pre-extracted @typescript-eslint/no-explicit-any findings (run by a
// GH Actions job or local script — eslint can't run inside Deno edge runtime)
// and enqueues one `codemod_replace_any` ai_jobs row per file.
//
// Hard caps:
//   - max 40 any-sites per file (truncated, recorded in note)
//   - max 30 new jobs per call (rest dropped with note)
//   - per-file idempotency key = sha256(file_path + ':' + git_sha)
//
// Auth: x-awip-service-token (cross-project + cron-safe).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";
import { validateInput } from "../_shared/contracts/ai-jobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-awip-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIP_SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN")!;

const MAX_SITES_PER_FILE = 40;
const MAX_JOBS_PER_CALL = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Site = { line: number; col: number; snippet: string; hint?: string };
type FileBucket = {
  file_path: string;
  ts_source: string;
  any_sites: Site[];
  surrounding_types?: string;
};

Deno.serve(withLogger("codemod-any-enqueue", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = req.headers.get("x-awip-service-token");
  if (!token || token !== AWIP_SERVICE_TOKEN) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const git_sha = String(body?.git_sha ?? "").trim();
  const files: FileBucket[] = Array.isArray(body?.files) ? body.files : [];
  if (!git_sha) return json({ error: "missing_git_sha" }, 400);
  if (!files.length) return json({ error: "no_files", enqueued: 0 }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const enqueued: Array<{ file_path: string; job_id?: string; status: string; note?: string }> = [];
  let count = 0;

  for (const f of files) {
    if (count >= MAX_JOBS_PER_CALL) {
      enqueued.push({ file_path: f.file_path, status: "skipped_cap" });
      continue;
    }
    const truncated = f.any_sites.length > MAX_SITES_PER_FILE;
    const sites = f.any_sites.slice(0, MAX_SITES_PER_FILE);
    if (!sites.length) {
      enqueued.push({ file_path: f.file_path, status: "skipped_no_sites" });
      continue;
    }

    const input = {
      file_path: f.file_path,
      ts_source: f.ts_source,
      any_sites: sites,
      surrounding_types: f.surrounding_types,
    };
    try {
      validateInput("codemod_replace_any", input);
    } catch (e) {
      enqueued.push({ file_path: f.file_path, status: "invalid_input", note: (e as Error).message });
      continue;
    }

    const idemKey = "codemod-any:" + await sha256Hex(`${f.file_path}:${git_sha}`);

    const { data: existing } = await admin
      .from("ai_jobs").select("id, status").eq("idempotency_key", idemKey).maybeSingle();
    if (existing) {
      enqueued.push({ file_path: f.file_path, job_id: existing.id, status: "idempotent" });
      continue;
    }

    const { data: row, error } = await admin.from("ai_jobs").insert({
      kind: "codemod_replace_any",
      input_json: input,
      priority: 200, // lower than draft_* so review queue stays drainable
      idempotency_key: idemKey,
    }).select("id, status").single();

    if (error) {
      enqueued.push({ file_path: f.file_path, status: "insert_failed", note: error.message });
      continue;
    }
    count++;
    enqueued.push({
      file_path: f.file_path,
      job_id: row.id,
      status: "enqueued",
      note: truncated ? `truncated to ${MAX_SITES_PER_FILE} sites` : undefined,
    });
  }

  return json({ git_sha, enqueued, total_enqueued: count, caps: { MAX_SITES_PER_FILE, MAX_JOBS_PER_CALL } });
}));
