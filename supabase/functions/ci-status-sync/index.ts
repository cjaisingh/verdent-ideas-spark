// ci-status-sync
// Polls GitHub Actions on cjaisingh/verdent-ideas-spark for every open
// discussion_action that has ci_workflow_file set. Updates ci_* columns and,
// when ci_close_on_success=true and the latest run on the configured branch
// concluded "success", auto-closes the action with a ci_auto_closed event.
//
// Auth: x-awip-service-token (cron) or operator JWT (manual).
// GET  /        → status
// POST /sync    → run pipeline
//
// Idempotent: a row is only updated when its cached fields actually change.

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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ci-status-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

interface WorkflowRun {
  id: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  html_url: string;
  head_sha: string;
  created_at: string;
}

async function fetchLatestRun(
  workflowFile: string,
  branch: string,
): Promise<WorkflowRun | null> {
  const url =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${
      encodeURIComponent(workflowFile)
    }/runs?branch=${encodeURIComponent(branch)}&per_page=1`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) {
    await r.text();
    throw new Error(`github ${r.status} for ${workflowFile}@${branch}`);
  }
  const body = await r.json() as { workflow_runs?: WorkflowRun[] };
  return body.workflow_runs?.[0] ?? null;
}

interface ActionRow {
  id: string;
  status: string;
  ci_workflow_file: string;
  ci_branch: string | null;
  ci_close_on_success: boolean;
  ci_last_status: string | null;
  ci_last_conclusion: string | null;
  ci_last_run_id: number | null;
  ci_last_run_sha: string | null;
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
  if (error || !data?.user) {
    return { ok: false, res: json({ error: "unauthorized" }, 401) };
  }
  const { data: hasOp } = await admin.rpc("has_role", {
    _user_id: data.user.id,
    _role: "operator",
  });
  if (!hasOp) return { ok: false, res: json({ error: "forbidden" }, 403) };
  return { ok: true };
}

async function runSync() {
  const { data: rows, error } = await admin
    .from("discussion_actions")
    .select(
      "id,status,ci_workflow_file,ci_branch,ci_close_on_success,ci_last_status,ci_last_conclusion,ci_last_run_id,ci_last_run_sha",
    )
    .not("ci_workflow_file", "is", null)
    .eq("status", "open");
  if (error) throw error;

  const list = (rows ?? []) as ActionRow[];
  let checked = 0, updated = 0, autoClosed = 0, errors = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const row of list) {
    checked++;
    const branch = row.ci_branch || "main";
    try {
      const run = await fetchLatestRun(row.ci_workflow_file, branch);
      if (!run) {
        details.push({ id: row.id, workflow: row.ci_workflow_file, branch, note: "no_runs" });
        continue;
      }

      const changed = run.id !== row.ci_last_run_id ||
        run.status !== row.ci_last_status ||
        (run.conclusion ?? null) !== row.ci_last_conclusion;

      const shouldAutoClose = row.ci_close_on_success &&
        run.status === "completed" &&
        run.conclusion === "success";

      if (!changed && !shouldAutoClose) continue;

      const patch: Record<string, unknown> = {
        ci_last_status: run.status,
        ci_last_conclusion: run.conclusion,
        ci_last_run_id: run.id,
        ci_last_run_url: run.html_url,
        ci_last_run_sha: run.head_sha,
        ci_last_checked_at: new Date().toISOString(),
      };
      if (shouldAutoClose) patch.status = "done";

      const { error: upErr } = await admin
        .from("discussion_actions")
        .update(patch)
        .eq("id", row.id);
      if (upErr) throw upErr;

      updated++;
      if (shouldAutoClose) {
        autoClosed++;
        await admin.from("discussion_action_events").insert({
          action_id: row.id,
          event_type: "ci_auto_closed",
          actor_label: "ci-status-sync",
          payload: {
            workflow: row.ci_workflow_file,
            branch,
            run_id: run.id,
            run_url: run.html_url,
            sha: run.head_sha,
          },
        });
      }
      details.push({
        id: row.id,
        workflow: row.ci_workflow_file,
        branch,
        run_id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        auto_closed: shouldAutoClose,
      });
    } catch (e) {
      errors++;
      details.push({
        id: row.id,
        workflow: row.ci_workflow_file,
        branch,
        error: (e as Error).message,
      });
    }
  }

  return { checked, updated, auto_closed: autoClosed, errors, details };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const auth = await authorize(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/ci-status-sync/, "") || "/";

  if (req.method === "GET" && path === "/") {
    const { count } = await admin
      .from("discussion_actions")
      .select("id", { count: "exact", head: true })
      .not("ci_workflow_file", "is", null)
      .eq("status", "open");
    return json({
      ok: true,
      repo: `${REPO_OWNER}/${REPO_NAME}`,
      open_linked_actions: count ?? 0,
    });
  }

  if (req.method === "POST" && (path === "/" || path === "/sync")) {
    const result = await runSync();
    return json({ ok: true, ...result });
  }

  return json({ error: "not found" }, 404);
};

Deno.serve(withLogger("ci-status-sync", handler));
