// gh-actions-watch
// Polls the GitHub Actions API for the most recent workflow runs on `main` in
// cjaisingh/verdent-ideas-spark and surfaces failures to sentinel + Telegram.
// Unlike ci-status-sync, this watcher is *not* scoped to discussion_actions —
// it catches any red on main so we hear about it before the inbox does.
//
// Auth: x-awip-service-token (cron) or operator JWT (manual).
// GET  /          → status (counts of open failures)
// POST /          → run sweep
//
// Dedup: keyed by `gh_actions_run:<run_id>` so we never double-alert. When a
// later run on main for the same workflow concludes "success" we mark the
// stored failure resolved and close any matching sentinel finding.

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
const GITHUB_TOKEN = Deno.env.get("GITHUB_REVIEWS_TOKEN");

const REPO_OWNER = "cjaisingh";
const REPO_NAME = "verdent-ideas-spark";
const BRANCH = "main";
const PAGE_SIZE = 20;
const BAD_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
]);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

interface WorkflowRun {
  id: number;
  name: string;
  path: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
  run_started_at: string;
  event: string;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-actions-watch",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

async function fetchRecentRuns(): Promise<WorkflowRun[]> {
  const url =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs` +
    `?branch=${encodeURIComponent(BRANCH)}&per_page=${PAGE_SIZE}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) {
    throw new Error(`github ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const body = await r.json() as { workflow_runs?: WorkflowRun[] };
  return body.workflow_runs ?? [];
}

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; res: Response }> {
  const svc = req.headers.get("x-awip-service-token") ??
    req.headers.get("x-service-token");
  if (svc && SERVICE_TOKEN && svc === SERVICE_TOKEN) return { ok: true };

  const authz = req.headers.get("authorization") ?? "";
  const tok = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7) : "";
  if (!tok) return { ok: false, res: json({ error: "unauthorized" }, 401) };
  const userClient = createClient(SUPABASE_URL, tok, { auth: { persistSession: false } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return { ok: false, res: json({ error: "unauthorized" }, 401) };
  const { data: hasOp } = await admin.rpc("has_role", {
    _user_id: data.user.id,
    _role: "operator",
  });
  if (!hasOp) return { ok: false, res: json({ error: "forbidden" }, 403) };
  return { ok: true };
}

async function sendTelegram(text: string) {
  const { data: settings } = await admin
    .from("credit_settings")
    .select("operator_telegram_chat_id,alerts_enabled")
    .eq("id", true)
    .maybeSingle();
  const chat = (settings as { operator_telegram_chat_id?: string | null; alerts_enabled?: boolean } | null);
  if (!chat?.alerts_enabled || !chat.operator_telegram_chat_id || !SERVICE_TOKEN) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/telegram-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": SERVICE_TOKEN,
      },
      body: JSON.stringify({
        chat_id: chat.operator_telegram_chat_id,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    console.error("telegram-send failed", e);
  }
}

async function runSweep() {
  const runs = await fetchRecentRuns();

  // Group by workflow name; newest first (API already returns newest first).
  const newestPerWorkflow = new Map<string, WorkflowRun>();
  for (const r of runs) {
    if (r.status !== "completed") continue;
    if (!newestPerWorkflow.has(r.name)) newestPerWorkflow.set(r.name, r);
  }

  let recorded = 0, alerted = 0, resolved = 0, skipped = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const r of runs) {
    if (r.status !== "completed" || !r.conclusion) continue;

    if (BAD_CONCLUSIONS.has(r.conclusion)) {
      // Upsert. ON CONFLICT (run_id) DO NOTHING via insert + ignore-23505.
      const { error: insErr } = await admin
        .from("gh_actions_runs")
        .insert({
          run_id: r.id,
          workflow: r.name,
          branch: BRANCH,
          sha: r.head_sha,
          conclusion: r.conclusion,
          html_url: r.html_url,
          run_started_at: r.run_started_at,
        });

      if (insErr) {
        // 23505 = duplicate, already seen → skip
        if ((insErr as { code?: string }).code === "23505") {
          skipped++;
          continue;
        }
        details.push({ run_id: r.id, error: insErr.message });
        continue;
      }
      recorded++;

      const dedupe = `gh_actions_run:${r.id}`;
      const sha7 = r.head_sha.slice(0, 7);
      const summary = `GitHub Actions failed on main: ${r.name} (${sha7})`;

      const { error: findErr } = await admin
        .from("sentinel_findings")
        .upsert({
          kind: "gh_actions_main_failure",
          severity: "high",
          subject_ref: { workflow: r.name, sha: r.head_sha, branch: BRANCH },
          summary,
          payload: {
            run_id: r.id,
            html_url: r.html_url,
            conclusion: r.conclusion,
            run_started_at: r.run_started_at,
            event: r.event,
          },
          status: "open",
          dedupe_key: dedupe,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "dedupe_key" });

      if (findErr) {
        details.push({ run_id: r.id, sentinel_error: findErr.message });
      } else {
        alerted++;
        await sendTelegram(
          `🚨 <b>CI red on main</b>\n${r.name} · <code>${sha7}</code>\n${r.conclusion}\n${r.html_url}`,
        );
      }
      details.push({ run_id: r.id, workflow: r.name, conclusion: r.conclusion, recorded: true });
    } else if (r.conclusion === "success") {
      // Auto-resolve: if this is the newest completed run for this workflow on
      // main and it succeeded, close any open failure rows + sentinel findings
      // for older runs of the same workflow.
      const newest = newestPerWorkflow.get(r.name);
      if (!newest || newest.id !== r.id) continue;

      const { data: openRows } = await admin
        .from("gh_actions_runs")
        .select("run_id")
        .eq("workflow", r.name)
        .is("resolved_at", null)
        .lt("run_started_at", r.run_started_at);

      const runIds = (openRows ?? []).map((row) => row.run_id as number);
      if (runIds.length === 0) continue;

      const nowIso = new Date().toISOString();
      await admin
        .from("gh_actions_runs")
        .update({ resolved_at: nowIso })
        .in("run_id", runIds);
      await admin
        .from("sentinel_findings")
        .update({ status: "resolved", resolved_at: nowIso })
        .eq("kind", "gh_actions_main_failure")
        .in("dedupe_key", runIds.map((id) => `gh_actions_run:${id}`));
      resolved += runIds.length;
      details.push({ workflow: r.name, auto_resolved: runIds });
    }
  }

  return { runs_checked: runs.length, recorded, alerted, resolved, skipped, details };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const auth = await authorize(req);
  if (!auth.ok) return auth.res;

  if (req.method === "GET") {
    const { count: openCount } = await admin
      .from("gh_actions_runs")
      .select("run_id", { count: "exact", head: true })
      .is("resolved_at", null);
    return json({
      ok: true,
      repo: `${REPO_OWNER}/${REPO_NAME}`,
      branch: BRANCH,
      open_failures: openCount ?? 0,
    });
  }

  if (req.method === "POST") {
    const result = await runSweep();
    return json({ ok: true, ...result });
  }

  return json({ error: "not found" }, 404);
};

Deno.serve(withLogger("gh-actions-watch", handler));
