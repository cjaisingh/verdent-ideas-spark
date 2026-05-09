import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregate, type AggregatorInput } from "./aggregator.ts";

const NOW = new Date("2026-05-09T06:00:00Z");

function base(): AggregatorInput {
  return {
    now: NOW,
    jobCadenceMinutes: { "qa-validate": 60, "overnight-phase-runner-15m": 15 },
    recentRuns: [],
    openActions: [],
    promotedTasks: {},
    findings: [],
    deferred: [],
    shifts: [],
    aiUsage: [],
  };
}

Deno.test("empty input yields neutral KPIs and lists", () => {
  const out = aggregate(base());
  assertEquals(out.kpis.automation_success_rate_24h, 1);
  assertEquals(out.kpis.automation_total_runs_24h, 0);
  assertEquals(out.kpis.ai_cost_24h_usd, 0);
  assertEquals(out.top_actions.length, 0);
  // Both jobs missing → both flagged as stuck.
  assertEquals(out.stuck_jobs.length, 2);
  assertEquals(out.stuck_jobs[0].silent_for_minutes, null);
});

Deno.test("stuck job detected when last run > 2x cadence ago", () => {
  const i = base();
  // qa-validate ran 2.5h ago — cadence 60 min, threshold 120 min.
  i.recentRuns = [{
    job: "qa-validate", status: "ok", status_code: 200, duration_ms: 100,
    created_at: new Date(NOW.getTime() - 150 * 60 * 1000).toISOString(),
  }];
  // overnight-phase-runner-15m ran 5 min ago — fresh.
  i.recentRuns.push({
    job: "overnight-phase-runner-15m", status: "ok", status_code: 200, duration_ms: 1,
    created_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
  });
  const out = aggregate(i);
  const stuck = out.stuck_jobs.map((s) => s.job);
  assert(stuck.includes("qa-validate"));
  assert(!stuck.includes("overnight-phase-runner-15m"));
});

Deno.test("promotion drift only flags promoted, undone, older than 72h", () => {
  const i = base();
  const old = new Date(NOW.getTime() - 80 * 3600 * 1000).toISOString();
  const fresh = new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString();
  i.openActions = [
    { id: "a1", short_num: 1, title: "stale promoted", status: "open", priority: "high",
      promoted_task_id: "t1", created_at: old, updated_at: old },
    { id: "a2", short_num: 2, title: "fresh promoted", status: "open", priority: "med",
      promoted_task_id: "t2", created_at: fresh, updated_at: fresh },
    { id: "a3", short_num: 3, title: "promoted but done", status: "open", priority: "low",
      promoted_task_id: "t3", created_at: old, updated_at: old },
    { id: "a4", short_num: 4, title: "not promoted", status: "open", priority: "high",
      promoted_task_id: null, created_at: old, updated_at: old },
  ];
  i.promotedTasks = {
    t1: { id: "t1", status: "doing", updated_at: old },
    t2: { id: "t2", status: "doing", updated_at: fresh },
    t3: { id: "t3", status: "done", updated_at: old },
  };
  const drift = aggregate(i).promotion_drift.map((d) => d.action_id);
  assertEquals(drift, ["a1"]);
});

Deno.test("top actions sorted by priority then age", () => {
  const i = base();
  const t = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
  i.openActions = [
    { id: "a1", short_num: 1, title: "low new", status: "open", priority: "low",
      promoted_task_id: null, created_at: t(1), updated_at: t(1) },
    { id: "a2", short_num: 2, title: "urgent old", status: "open", priority: "urgent",
      promoted_task_id: null, created_at: t(20), updated_at: t(20) },
    { id: "a3", short_num: 3, title: "high old", status: "open", priority: "high",
      promoted_task_id: null, created_at: t(30), updated_at: t(30) },
    { id: "a4", short_num: 4, title: "high new", status: "open", priority: "high",
      promoted_task_id: null, created_at: t(2), updated_at: t(2) },
  ];
  const order = aggregate(i).top_actions.map((a) => a.action_id);
  assertEquals(order, ["a2", "a3", "a4", "a1"]);
});

Deno.test("findings filtered to medium+ and capped", () => {
  const i = base();
  for (let n = 0; n < 30; n++) {
    i.findings.push({
      id: `f${n}`, severity: n % 2 === 0 ? "high" : "low",
      category: "x", title: `t${n}`, acknowledged: false, created_at: NOW.toISOString(),
    });
  }
  i.findings.push({ id: "ack", severity: "high", category: "x", title: "ack me",
    acknowledged: true, created_at: NOW.toISOString() });
  const out = aggregate(i);
  assert(out.open_findings.length <= 25);
  assert(out.open_findings.every((f) => f.severity === "high"));
});

Deno.test("revisit items include only deferred items due today or earlier", () => {
  const i = base();
  i.deferred = [
    { id: "d1", title: "due", severity: "medium", defer_until: "2026-05-09", status: "deferred" },
    { id: "d2", title: "future", severity: "low", defer_until: "2027-01-01", status: "deferred" },
    { id: "d3", title: "resolved", severity: "high", defer_until: "2025-01-01", status: "resolved" },
  ];
  const out = aggregate(i);
  assertEquals(out.revisit_items.map((r) => r.id), ["d1"]);
});

Deno.test("KPIs compute success rate and cost", () => {
  const i = base();
  i.recentRuns = [
    { job: "qa-validate", status: "ok", status_code: 200, duration_ms: 1, created_at: NOW.toISOString() },
    { job: "qa-validate", status: "error", status_code: 500, duration_ms: 1, created_at: NOW.toISOString() },
    { job: "qa-validate", status: "ok", status_code: 200, duration_ms: 1, created_at: NOW.toISOString() },
    { job: "qa-validate", status: "ok", status_code: 200, duration_ms: 1, created_at: NOW.toISOString() },
  ];
  i.aiUsage = [{ cost_usd: 0.12, created_at: NOW.toISOString() }, { cost_usd: 0.03, created_at: NOW.toISOString() }];
  const out = aggregate(i);
  assertEquals(out.kpis.automation_total_runs_24h, 4);
  assertEquals(out.kpis.automation_success_rate_24h, 0.75);
  assertEquals(out.kpis.ai_cost_24h_usd, 0.15);
});
