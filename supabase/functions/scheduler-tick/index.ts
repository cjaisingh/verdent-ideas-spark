// scheduler-tick: claims due jobs and dispatches them.
// Cron: every minute via pg_cron `scheduled-scheduler-tick`.
// Auth: AWIP_SERVICE_TOKEN (or no auth for pg_net call — request_id only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { withLogger } from "../_shared/logger.ts";
import { LOCAL_HANDLERS } from "../_shared/scheduler-handlers.ts";
import type { ScheduledJobRow } from "../_shared/contracts/scheduler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const TICK_BATCH_SIZE = 25;
const LOCK_MINUTES = 5;
const RETRY_BACKOFF_SEC = [30, 120, 600, 1800]; // 30s, 2m, 10m, 30m

function nextRunOnRetry(attempts: number): string {
  const sec = RETRY_BACKOFF_SEC[Math.min(attempts, RETRY_BACKOFF_SEC.length - 1)];
  return new Date(Date.now() + sec * 1000).toISOString();
}

// naive recurrence parser: only "every:Ns|m|h|d" — operator UI restricts to these for v1.
// e.g. "every:1d", "every:7d", "every:6h"
function nextOccurrenceFromRecurrence(rec: string | null, from: Date): Date | null {
  if (!rec) return null;
  const m = /^every:(\d+)([smhd])$/.exec(rec.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(from.getTime() + n * mult);
}

async function dispatchLocal(job: ScheduledJobRow): Promise<void> {
  const handler = LOCAL_HANDLERS[job.kind];
  if (!handler) {
    await markFailed(job, `no local handler for kind '${job.kind}'`, false);
    return;
  }
  try {
    const res = await handler(job);
    if (res.status === "done") await markDone(job, res.result);
    else await markFailed(job, res.error, res.retryable);
  } catch (e) {
    await markFailed(job, e instanceof Error ? e.message : String(e), true);
  }
}

async function dispatchRemote(job: ScheduledJobRow, callbackUrl: string): Promise<void> {
  // Look up a per-module service token. Pick any non-revoked one.
  const { data: tokens } = await supabase
    .from("module_service_tokens")
    .select("token_hash")
    .eq("owning_module", job.owning_module)
    .is("revoked_at", null)
    .limit(1);
  // The token *hash* is stored; the raw token only exists on the FM side.
  // For remote dispatch we instead trust the callback URL itself and rely on
  // the FM endpoint to verify our Idempotency-Key + a per-endpoint shared
  // secret declared by the FM at endpoint registration time (future ADR).
  // v1: send Idempotency-Key + AWIP_SERVICE_TOKEN as bearer for symmetry.
  void tokens;

  try {
    const resp = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${job.id}:${job.attempts}`,
        "x-awip-service-token": Deno.env.get("AWIP_SERVICE_TOKEN") ?? "",
      },
      body: JSON.stringify({
        kind: job.kind,
        payload: job.payload,
        tenant_id: job.tenant_id,
        subject_type: job.subject_type,
        subject_id: job.subject_id,
        attempt: job.attempts,
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    const body = await resp.json().catch(() => ({} as Record<string, unknown>));
    if (resp.status === 200) {
      await markDone(job, body);
      await supabase.from("module_endpoints").update({ last_dispatch_ok_at: new Date().toISOString(), last_error: null }).eq("module", job.owning_module);
    } else if (resp.status === 409) {
      await markDone(job, { duplicate: true });
    } else if (resp.status >= 500) {
      const msg = `remote ${resp.status}: ${typeof body === "object" ? JSON.stringify(body) : String(body)}`;
      await markFailed(job, msg, true);
      await supabase.from("module_endpoints").update({ last_dispatch_err_at: new Date().toISOString(), last_error: msg }).eq("module", job.owning_module);
    } else {
      const msg = `remote ${resp.status}: ${typeof body === "object" ? JSON.stringify(body) : String(body)}`;
      await markFailed(job, msg, false);
      await supabase.from("module_endpoints").update({ last_dispatch_err_at: new Date().toISOString(), last_error: msg }).eq("module", job.owning_module);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markFailed(job, `remote dispatch error: ${msg}`, true);
    await supabase.from("module_endpoints").update({ last_dispatch_err_at: new Date().toISOString(), last_error: msg }).eq("module", job.owning_module);
  }
}

async function markDone(job: ScheduledJobRow, result: unknown): Promise<void> {
  const nextRun = nextOccurrenceFromRecurrence(job.recurrence, new Date(job.run_at));
  if (nextRun) {
    // recurring: bump run_at, reset attempts, keep pending.
    await supabase.from("scheduled_jobs").update({
      status: "pending",
      attempts: 0,
      last_error: null,
      result: result as Record<string, unknown> | null,
      run_at: nextRun.toISOString(),
      locked_until: null,
      locked_by: null,
    }).eq("id", job.id);
  } else {
    await supabase.from("scheduled_jobs").update({
      status: "done",
      result: result as Record<string, unknown> | null,
      locked_until: null,
      locked_by: null,
    }).eq("id", job.id);
  }
}

async function markFailed(job: ScheduledJobRow, error: string, retryable: boolean): Promise<void> {
  const attempts = job.attempts + 1;
  if (retryable && attempts < job.max_retries) {
    await supabase.from("scheduled_jobs").update({
      status: "pending",
      attempts,
      last_error: error.slice(0, 2000),
      run_at: nextRunOnRetry(attempts),
      locked_until: null,
      locked_by: null,
    }).eq("id", job.id);
  } else {
    await supabase.from("scheduled_jobs").update({
      status: "failed",
      attempts,
      last_error: error.slice(0, 2000),
      locked_until: null,
      locked_by: null,
    }).eq("id", job.id);
  }
}

async function runTick(): Promise<{ claimed: number; dispatched: number }> {
  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
  const lockBy = `tick:${crypto.randomUUID().slice(0, 8)}`;

  // Claim batch atomically via UPDATE ... RETURNING.
  const { data: claimedIds } = await supabase.rpc("claim_scheduled_jobs", {
    _now: now,
    _lock_until: lockUntil,
    _lock_by: lockBy,
    _limit: TICK_BATCH_SIZE,
  });

  if (!Array.isArray(claimedIds) || claimedIds.length === 0) {
    return { claimed: 0, dispatched: 0 };
  }

  const ids = (claimedIds as Array<{ id: string }>).map((r) => r.id);
  const { data: jobs } = await supabase.from("scheduled_jobs").select("*").in("id", ids);
  if (!jobs) return { claimed: ids.length, dispatched: 0 };

  // Resolve handler mode per job via catalog + module_endpoints.
  const kinds = Array.from(new Set(jobs.map((j) => j.kind)));
  const { data: catalogRows } = await supabase
    .from("scheduler_kind_catalog")
    .select("kind, handler_mode, owning_module")
    .in("kind", kinds);
  const catalog = new Map<string, { handler_mode: string; owning_module: string }>();
  for (const r of catalogRows ?? []) catalog.set(r.kind, { handler_mode: r.handler_mode, owning_module: r.owning_module });

  const modules = Array.from(new Set(jobs.map((j) => j.owning_module)));
  const { data: endpointRows } = await supabase.from("module_endpoints").select("module, callback_url").in("module", modules);
  const endpoints = new Map<string, string>();
  for (const e of endpointRows ?? []) endpoints.set(e.module, e.callback_url);

  await Promise.all(jobs.map(async (j) => {
    const row = j as ScheduledJobRow;
    const cat = catalog.get(row.kind);
    const mode = cat?.handler_mode ?? (LOCAL_HANDLERS[row.kind] ? "local" : "remote");
    // Flip running before dispatch (event log will record it).
    await supabase.from("scheduled_jobs").update({ status: "running" }).eq("id", row.id);
    if (mode === "remote") {
      const url = endpoints.get(row.owning_module);
      if (!url) {
        await markFailed(row, `no module_endpoint registered for module '${row.owning_module}'`, false);
        return;
      }
      await dispatchRemote(row, url);
    } else {
      await dispatchLocal(row);
    }
  }));

  return { claimed: ids.length, dispatched: jobs.length };
}

Deno.serve(withLogger("scheduler-tick", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: require AWIP_SERVICE_TOKEN (cron) OR operator/admin Bearer JWT.
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
  const provided = req.headers.get("x-awip-service-token") ?? req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

  if (!triggeredByCron) {
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: isOp } = await userClient.rpc("has_role", { _user_id: u.user.id, _role: "operator" });
    const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
    if (!isOp && !isAdmin) return json({ error: "forbidden" }, 403);
  }

  try {
    const out = await runTick();
    ctx.attach("tick", out);
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}));

