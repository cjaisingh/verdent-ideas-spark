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
