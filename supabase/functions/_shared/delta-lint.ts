// Hermes slice 2: post-write delta lint.
//
// Pure helper. Lints proposed file contents BEFORE the calling edge function
// returns, so syntax/type/parse breakage never reaches the GH mirror.
//
// Usage:
//   import { lintDelta } from "../_shared/delta-lint.ts";
//   const results = await lintDelta(files, { caller: "companion-cloud-chat", requestId });
//   if (results.some(r => r.status === "failed")) { ... }
//
// Best-effort: never throws. Records every file in `lint_delta_runs`.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

export type LintInput = { path: string; content: string };

export type LintResult = {
  path: string;
  language: "ts" | "tsx" | "js" | "jsx" | "json" | "md" | "other";
  status: "ok" | "failed" | "skipped" | "error";
  duration_ms: number;
  bytes: number;
  error_class?: "syntax" | "type" | "parse" | "timeout" | "runtime";
  error_message?: string;
  meta?: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

let _client: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!_client) _client = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  return _client;
}

function detectLanguage(path: string): LintResult["language"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "md";
  return "other";
}

function classifyDenoStderr(stderr: string): { error_class: "syntax" | "type"; error_message: string } {
  const msg = stderr.trim().slice(0, 500);
  // Deno reports type errors as "TS####" and parse/syntax as "Parse error"/"Expected".
  const isSyntax = /Parse error|Expected|Unexpected token|Unterminated|Unexpected character/i.test(stderr);
  return {
    error_class: isSyntax ? "syntax" : "type",
    error_message: msg || "deno check failed",
  };
}

async function denoCheck(content: string, suffix: ".ts" | ".tsx"): Promise<{
  status: LintResult["status"];
  error_class?: LintResult["error_class"];
  error_message?: string;
  meta: Record<string, unknown>;
}> {
  let tmp: string | null = null;
  try {
    tmp = await Deno.makeTempFile({ suffix });
    await Deno.writeTextFile(tmp, content);
    const cmd = new Deno.Command("deno", {
      args: ["check", "--no-lock", "--quiet", tmp],
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, 5_000);
    const out = await child.output();
    clearTimeout(timer);
    const stderr = new TextDecoder().decode(out.stderr);
    if (out.success) return { status: "ok", meta: { exit_code: 0 } };
    if (out.signal === "SIGKILL") {
      return {
        status: "failed",
        error_class: "timeout",
        error_message: "deno check exceeded 5s",
        meta: { exit_code: out.code, signal: "SIGKILL" },
      };
    }
    const cls = classifyDenoStderr(stderr);
    return { status: "failed", ...cls, meta: { exit_code: out.code, stderr_len: stderr.length } };
  } catch (e) {
    return {
      status: "error",
      error_class: "runtime",
      error_message: e instanceof Error ? e.message.slice(0, 500) : String(e),
      meta: {},
    };
  } finally {
    if (tmp) { try { await Deno.remove(tmp); } catch { /* ignore */ } }
  }
}

function jsonParse(content: string): {
  status: LintResult["status"];
  error_class?: LintResult["error_class"];
  error_message?: string;
} {
  try {
    JSON.parse(content);
    return { status: "ok" };
  } catch (e) {
    return {
      status: "failed",
      error_class: "parse",
      error_message: e instanceof Error ? e.message.slice(0, 500) : String(e),
    };
  }
}

export async function lintDelta(
  files: LintInput[],
  opts?: { caller?: string; requestId?: string },
): Promise<LintResult[]> {
  const caller = opts?.caller ?? "unknown";
  const requestId = opts?.requestId ?? null;
  const results: LintResult[] = [];
  const sb = client();

  for (const f of files) {
    const lang = detectLanguage(f.path);
    const bytes = new TextEncoder().encode(f.content).length;
    const t0 = Date.now();
    let r: LintResult;

    if (lang === "ts" || lang === "tsx") {
      const out = await denoCheck(f.content, lang === "tsx" ? ".tsx" : ".ts");
      r = {
        path: f.path, language: lang, bytes,
        duration_ms: Date.now() - t0,
        status: out.status,
        error_class: out.error_class,
        error_message: out.error_message,
        meta: out.meta,
      };
    } else if (lang === "json") {
      const out = jsonParse(f.content);
      r = {
        path: f.path, language: lang, bytes,
        duration_ms: Date.now() - t0,
        status: out.status,
        error_class: out.error_class,
        error_message: out.error_message,
        meta: {},
      };
    } else {
      r = {
        path: f.path, language: lang, bytes,
        duration_ms: Date.now() - t0,
        status: "skipped",
        meta: { reason: `${lang} not linted` },
      };
    }

    results.push(r);

    // Best-effort log; never throws.
    if (sb) {
      try {
        await sb.from("lint_delta_runs").insert({
          caller,
          request_id: requestId,
          file_path: r.path,
          language: r.language,
          status: r.status,
          duration_ms: r.duration_ms,
          bytes: r.bytes,
          error_class: r.error_class ?? null,
          error_message: r.error_message ?? null,
          meta: r.meta ?? {},
        });
      } catch { /* swallow */ }
    }
  }

  return results;
}
