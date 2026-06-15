import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkCronSilence, checkFiveXxSpike, checkSecretAge, checkAdminGrants,
} from "./checks.ts";

const NOW = new Date("2026-05-09T12:00:00Z");

Deno.test("cron silence flags jobs older than 2x cadence and skips fresh ones", () => {
  const cadence = { "qa-validate": 60, "fresh-job": 60 };
  const runs = [
    { job: "qa-validate", created_at: new Date(NOW.getTime() - 130 * 60_000).toISOString() },
    { job: "fresh-job", created_at: new Date(NOW.getTime() - 30 * 60_000).toISOString() },
  ];
  const out = checkCronSilence(NOW, cadence, runs);
  assertEquals(out.length, 1);
  assertEquals(out[0].kind, "cron_silence");
  assertEquals(out[0].dedupe_key, "cron_silence:qa-validate");
  assertEquals(out[0].severity, "high");
});

Deno.test("cron silence flags never-run jobs as silent forever", () => {
  const out = checkCronSilence(NOW, { "missing-job": 1440 }, []);
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "medium");
  assertEquals(out[0].payload.last_run_at, null);
});

Deno.test("5xx spike requires threshold and reports top function", () => {
  const logs = Array.from({ length: 6 }, (_, i) => ({
    status: 500, created_at: new Date(NOW.getTime() - i * 60_000).toISOString(),
    function_name: i < 4 ? "awip-api" : "morning-review",
  }));
  const out = checkFiveXxSpike(NOW, 15, logs);
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "high");
  const by = out[0].payload.by_function as Record<string, number>;
  assertEquals(by["awip-api"], 4);
});

Deno.test("5xx spike below threshold returns nothing", () => {
  const out = checkFiveXxSpike(NOW, 15, [
    { status: 500, created_at: NOW.toISOString(), function_name: "x" },
  ]);
  assertEquals(out, []);
});

Deno.test("5xx spike escalates to critical at 20", () => {
  const logs = Array.from({ length: 22 }, () => ({
    status: 500, created_at: NOW.toISOString(), function_name: "awip-api",
  }));
  assertEquals(checkFiveXxSpike(NOW, 15, logs)[0].severity, "critical");
});

Deno.test("secret age flags only secrets older than the threshold", () => {
  const old = new Date(NOW.getTime() - 100 * 24 * 3600 * 1000).toISOString();
  const fresh = new Date(NOW.getTime() - 10 * 24 * 3600 * 1000).toISOString();
  const out = checkSecretAge(NOW, [
    { key: "OLD_KEY", updated_at: old },
    { key: "FRESH_KEY", updated_at: fresh },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].dedupe_key, "secret_age:OLD_KEY");
  assertEquals(out[0].severity, "low");
});

Deno.test("admin grants only flag granted+admin within window", () => {
  const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  const old = new Date(NOW.getTime() - 60 * 60_000).toISOString();
  const out = checkAdminGrants(NOW, 15, [
    { id: "1", role: "admin", action: "granted", target_user_id: "u1aaaaaa", created_at: recent },
    { id: "2", role: "operator", action: "granted", target_user_id: "u2", created_at: recent },
    { id: "3", role: "admin", action: "revoked", target_user_id: "u3", created_at: recent },
    { id: "4", role: "admin", action: "granted", target_user_id: "u4", created_at: old },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].dedupe_key, "role_grant:1");
  assertEquals(out[0].severity, "high");
});

Deno.test("dedupe keys are stable across repeated calls for same conditions", () => {
  const cadence = { "qa-validate": 60 };
  const runs = [{ job: "qa-validate", created_at: new Date(NOW.getTime() - 200 * 60_000).toISOString() }];
  const a = checkCronSilence(NOW, cadence, runs)[0].dedupe_key;
  const b = checkCronSilence(NOW, cadence, runs)[0].dedupe_key;
  assertEquals(a, b);
  assert(a.startsWith("cron_silence:"));
});

import { checkJobErrorRate } from "./checks.ts";

Deno.test("job_error_rate: medium when >=2 errors in last hour", () => {
  const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
  const runs = [
    { job: "morning-review", status: "error", created_at: t(10) },
    { job: "morning-review", status: "error", created_at: t(40) },
    { job: "morning-review", status: "ok",    created_at: t(120) },
  ];
  const out = checkJobErrorRate(NOW, runs);
  assertEquals(out.length, 1);
  assertEquals(out[0].kind, "job_error_rate");
  assertEquals(out[0].severity, "medium");
  assertEquals(out[0].subject_ref.job, "morning-review");
});

Deno.test("job_error_rate: high when >=20 errors in 24h with recent activity", () => {
  // Implementation tightened 2026-Q2: a 24h spike only fires when at least one
  // error is still landing in the last hour — otherwise it's stale aftershock.
  const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
  const runs = Array.from({ length: 20 }, (_, i) => ({
    job: "sentinel-tick", status: "error", created_at: t(60 * (i + 2)),
  }));
  runs.push({ job: "sentinel-tick", status: "error", created_at: t(10) });
  runs.push({ job: "sentinel-tick", status: "ok", created_at: t(30) });
  const out = checkJobErrorRate(NOW, runs);
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "high");
});

Deno.test("job_error_rate: high when only errors and no successes in 24h", () => {
  // Must include a last-hour error so the "no successes" branch fires.
  const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
  const runs = [
    { job: "lessons-synthesize", status: "error", created_at: t(120) },
    { job: "lessons-synthesize", status: "error", created_at: t(15) },
  ];
  const out = checkJobErrorRate(NOW, runs);
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "high");
});

Deno.test("job_error_rate: silent when only successes", () => {
  const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
  const runs = [
    { job: "morning-review", status: "ok", created_at: t(60) },
    { job: "morning-review", status: "ok", created_at: t(120) },
  ];
  const out = checkJobErrorRate(NOW, runs);
  assertEquals(out.length, 0);
});

Deno.test("job_error_rate: ignores jobs not in allowlist", () => {
  const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
  const runs = Array.from({ length: 5 }, (_, i) => ({
    job: "qa-validate", status: "error", created_at: t(60 * (i + 1)),
  }));
  const out = checkJobErrorRate(NOW, runs);
  assertEquals(out.length, 0);
});

Deno.test("job_error_rate: includes triggering run ids in subject_ref + payload", () => {
  const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
  const runs = [
    { id: "r-newest", job: "morning-review", status: "error", created_at: t(5) },
    { id: "r-mid",    job: "morning-review", status: "error", created_at: t(40) },
    { id: "r-old",    job: "morning-review", status: "error", created_at: t(60 * 5) },
    { id: "r-ok",     job: "morning-review", status: "ok",    created_at: t(120) },
  ];
  const out = checkJobErrorRate(NOW, runs);
  assertEquals(out.length, 1);
  const f = out[0];
  // Newest first, capped to ids only
  assertEquals(f.subject_ref.run_ids, ["r-newest", "r-mid", "r-old"]);
  assertEquals(f.subject_ref.latest_error_run_id, "r-newest");
  assertEquals(f.payload.error_run_ids_24h, ["r-newest", "r-mid", "r-old"]);
  assertEquals(f.payload.error_run_ids_1h, ["r-newest", "r-mid"]);
});

import { checkBudgetProjection } from "./checks.ts";
import { checkGhActionsWatchAuthFailed } from "./checks.ts";
import { checkGhActionsWatchStale } from "./checks.ts";

const BNOW = new Date("2026-05-17T14:00:00Z");

Deno.test("budget: no signals → no findings", () => {
  assertEquals(checkBudgetProjection(BNOW, null, []).length, 0);
});

Deno.test("budget: no budget → no findings", () => {
  const r = checkBudgetProjection(BNOW, { budget: 0, burn_7d_per_day: 50, projected_month_end: 1500 }, []);
  assertEquals(r.length, 0);
});

Deno.test("budget: no burn → no findings", () => {
  const r = checkBudgetProjection(BNOW, { budget: 1000, burn_7d_per_day: 0, projected_month_end: 0 }, []);
  assertEquals(r.length, 0);
});

Deno.test("budget: below 80% → no findings", () => {
  // 20/day * 30 = 600 = 60% of 1000
  const r = checkBudgetProjection(BNOW, { budget: 1000, burn_7d_per_day: 20, projected_month_end: 600 }, []);
  assertEquals(r.length, 0);
});

Deno.test("budget: crosses 80% → one warn finding", () => {
  // 30/day * 30 = 900 = 90% of 1000
  const r = checkBudgetProjection(BNOW, { budget: 1000, burn_7d_per_day: 30, projected_month_end: 900 }, []);
  assertEquals(r.length, 1);
  assertEquals(r[0].kind, "budget_projection_80");
  assertEquals(r[0].severity, "high");
  assertEquals(r[0].dedupe_key, "budget_projection_80:2026-05");
});

Deno.test("budget: crosses 100% → both findings if neither fired", () => {
  // 40/day * 30 = 1200 = 120% of 1000
  const r = checkBudgetProjection(BNOW, { budget: 1000, burn_7d_per_day: 40, projected_month_end: 1200 }, []);
  assertEquals(r.length, 2);
  const kinds = r.map((c) => c.kind).sort();
  assertEquals(kinds, ["budget_projection_100", "budget_projection_80"]);
  const crit = r.find((c) => c.kind === "budget_projection_100")!;
  assertEquals(crit.severity, "critical");
});

Deno.test("budget: 80 already fired this month → only 100 fires", () => {
  const r = checkBudgetProjection(BNOW, { budget: 1000, burn_7d_per_day: 40, projected_month_end: 1200 }, [
    { year_month: "2026-05", threshold_pct: 80 },
  ]);
  assertEquals(r.length, 1);
  assertEquals(r[0].kind, "budget_projection_100");
});

Deno.test("budget: previous month's row does not block current month", () => {
  const r = checkBudgetProjection(BNOW, { budget: 1000, burn_7d_per_day: 30, projected_month_end: 900 }, [
    { year_month: "2026-04", threshold_pct: 80 },
  ]);
  assertEquals(r.length, 1);
  assertEquals(r[0].kind, "budget_projection_80");
});

Deno.test("gh_actions_watch_auth_failed: flags repeated 401/403 POSTs", () => {
  const now = new Date("2026-05-31T08:00:00Z");
  const rows = [
    { status: 401, method: "POST", created_at: "2026-05-31T07:58:00Z" },
    { status: 401, method: "POST", created_at: "2026-05-31T07:55:00Z" },
    { status: 403, method: "POST", created_at: "2026-05-31T07:50:00Z" },
    { status: 401, method: "GET", created_at: "2026-05-31T07:59:00Z" },
  ];
  const out = checkGhActionsWatchAuthFailed(now, rows);
  assertEquals(out.length, 1);
  assertEquals(out[0].kind, "gh_actions_watch_auth_failed");
  assertEquals(out[0].severity, "high");
  // Dedupe key is anchored on the latest failure row's hour bucket — pure
  // function of input, independent of when the tick runs.
  const expectedBucket = Math.floor(
    Date.UTC(2026, 4, 31, 7, 58) / (60 * 60_000),
  );
  assertEquals(out[0].dedupe_key, `gh_actions_watch_auth_failed:${expectedBucket}`);
});

Deno.test("gh_actions_watch_auth_failed: ignores sparse or old auth errors", () => {
  const now = new Date("2026-05-31T08:00:00Z");
  const rows = [
    { status: 401, method: "POST", created_at: "2026-05-31T07:58:00Z" },
    { status: 401, method: "POST", created_at: "2026-05-31T07:10:00Z" },
  ];
  assertEquals(checkGhActionsWatchAuthFailed(now, rows).length, 0);
});

Deno.test("gh_actions_watch_stale: uses latest request time, not failure rows", () => {
  const now = new Date("2026-05-31T08:00:00Z");
  assertEquals(checkGhActionsWatchStale(now, "2026-05-31T07:40:01Z").length, 0);
  const stale = checkGhActionsWatchStale(now, "2026-05-31T07:20:00Z");
  assertEquals(stale.length, 1);
  assertEquals(stale[0].kind, "gh_actions_watch_stale");
});

import { checkAliasRevokeBurst } from "./checks.ts";

Deno.test("alias_revoke_burst: 11 soft revokes in window → one high finding", () => {
  const now = new Date("2026-05-21T18:00:00Z");
  const tenant = "11111111-1111-1111-1111-111111111111";
  const rows = Array.from({ length: 11 }, (_, i) => ({
    tenant_id: tenant,
    kind: "alias_revoke",
    created_at: new Date(now.getTime() - i * 30_000).toISOString(),
  }));
  const r = checkAliasRevokeBurst(now, 15, 10, rows);
  assertEquals(r.length, 1);
  assertEquals(r[0].kind, "alias_revoke_burst");
  assertEquals(r[0].severity, "high");
  assert(r[0].dedupe_key.startsWith(`alias_revoke_burst:${tenant}:`));
});

Deno.test("alias_revoke_burst: 3 hard revokes escalate to critical", () => {
  const now = new Date("2026-05-21T18:00:00Z");
  const tenant = "22222222-2222-2222-2222-222222222222";
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({
      tenant_id: tenant, kind: "alias_revoke",
      created_at: new Date(now.getTime() - i * 30_000).toISOString(),
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      tenant_id: tenant, kind: "alias_hard_revoke",
      created_at: new Date(now.getTime() - i * 30_000).toISOString(),
    })),
  ];
  const r = checkAliasRevokeBurst(now, 15, 10, rows);
  assertEquals(r.length, 1);
  assertEquals(r[0].severity, "critical");
});

Deno.test("alias_revoke_burst: below threshold = no finding; per-tenant grouping", () => {
  const now = new Date("2026-05-21T18:00:00Z");
  const t1 = "33333333-3333-3333-3333-333333333333";
  const t2 = "44444444-4444-4444-4444-444444444444";
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => ({
      tenant_id: t1, kind: "alias_revoke",
      created_at: new Date(now.getTime() - i * 30_000).toISOString(),
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      tenant_id: t2, kind: "alias_revoke",
      created_at: new Date(now.getTime() - i * 30_000).toISOString(),
    })),
  ];
  const r = checkAliasRevokeBurst(now, 15, 10, rows);
  assertEquals(r.length, 1);
  assertEquals(r[0].subject_ref.tenant_id, t2);
});

Deno.test("alias_revoke_burst: events outside window ignored", () => {
  const now = new Date("2026-05-21T18:00:00Z");
  const tenant = "55555555-5555-5555-5555-555555555555";
  const rows = Array.from({ length: 11 }, (_, i) => ({
    tenant_id: tenant, kind: "alias_revoke",
    // All older than 15min window
    created_at: new Date(now.getTime() - (20 + i) * 60_000).toISOString(),
  }));
  const r = checkAliasRevokeBurst(now, 15, 10, rows);
  assertEquals(r.length, 0);
});

// --- alias_corpus_ready ---------------------------------------------------
import { checkAliasCorpusReady, ALIAS_CORPUS_READY_THRESHOLD } from "./checks.ts";

Deno.test("alias_corpus_ready: below threshold → no finding", () => {
  assertEquals(checkAliasCorpusReady(999).length, 0);
  assertEquals(checkAliasCorpusReady(0).length, 0);
});

Deno.test("alias_corpus_ready: at threshold → one info finding with stable dedupe key", () => {
  const r = checkAliasCorpusReady(ALIAS_CORPUS_READY_THRESHOLD);
  assertEquals(r.length, 1);
  assertEquals(r[0].kind, "alias_corpus_ready");
  assertEquals(r[0].severity, "info");
  assertEquals(r[0].dedupe_key, "alias_corpus_ready");
  assertEquals((r[0].payload as { alias_count: number }).alias_count, ALIAS_CORPUS_READY_THRESHOLD);
});

Deno.test("alias_corpus_ready: above threshold → finding payload carries actual count", () => {
  const r = checkAliasCorpusReady(5_000);
  assertEquals(r.length, 1);
  assertEquals((r[0].payload as { alias_count: number }).alias_count, 5_000);
  assert(r[0].summary.includes("5000"));
});

Deno.test("alias_corpus_ready: custom threshold honoured", () => {
  assertEquals(checkAliasCorpusReady(50, 100).length, 0);
  assertEquals(checkAliasCorpusReady(100, 100).length, 1);
});
