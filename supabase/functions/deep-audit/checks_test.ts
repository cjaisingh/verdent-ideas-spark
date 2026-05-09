import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  auditSecrets, auditAdmins, auditAutomation, auditRls, auditRetention, summarise,
} from "./checks.ts";

const NOW = new Date("2026-05-09T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

Deno.test("auditSecrets — flags >90 and >180 day secrets", () => {
  const r = auditSecrets(
    [
      { key: "FRESH", updated_at: daysAgo(10) },
      { key: "STALE_90", updated_at: daysAgo(100) },
      { key: "STALE_180", updated_at: daysAgo(200) },
    ],
    NOW,
  );
  assertEquals(r.findings.length, 2);
  assertEquals(r.findings[0].severity, "medium");
  assertEquals(r.findings[1].severity, "high");
  assertEquals(r.status, "fail");
});

Deno.test("auditSecrets — empty + all fresh = ok", () => {
  const r = auditSecrets([{ key: "A", updated_at: daysAgo(5) }], NOW);
  assertEquals(r.status, "ok");
  assertEquals(r.findings.length, 0);
});

Deno.test("auditAdmins — zero admins is critical", () => {
  const r = auditAdmins([], [], NOW);
  assertEquals(r.findings[0].severity, "critical");
  assertEquals(r.status, "fail");
});

Deno.test("auditAdmins — one admin = warn", () => {
  const r = auditAdmins(["u1"], [], NOW);
  assertEquals(r.status, "warn");
  assertEquals(r.findings[0].severity, "medium");
});

Deno.test("auditAdmins — too many admins = warn", () => {
  const r = auditAdmins(["u1","u2","u3","u4","u5","u6"], [], NOW);
  assertEquals(r.status, "warn");
});

Deno.test("auditAdmins — recent admin-grant spike = high", () => {
  const r = auditAdmins(
    ["u1","u2"],
    [
      { role: "admin", action: "granted", created_at: daysAgo(1) },
      { role: "admin", action: "granted", created_at: daysAgo(5) },
      { role: "admin", action: "granted", created_at: daysAgo(10) },
    ],
    NOW,
  );
  assertEquals(r.status, "fail");
  assertEquals(r.findings[0].severity, "high");
});

Deno.test("auditAutomation — high error rate flagged", () => {
  const runs = [
    ...Array.from({ length: 6 }, () => ({ job: "x", status: "error", created_at: daysAgo(1) })),
    ...Array.from({ length: 4 }, () => ({ job: "x", status: "ok", created_at: daysAgo(1) })),
  ];
  const r = auditAutomation(runs);
  assertEquals(r.status, "fail");
  assertEquals(r.findings[0].severity, "high");
});

Deno.test("auditAutomation — empty input = ok", () => {
  const r = auditAutomation([]);
  assertEquals(r.status, "ok");
});

Deno.test("auditRls — disabled RLS is critical, no-policy is high", () => {
  const r = auditRls([
    { table_name: "good", rls_enabled: true, policies: 2 },
    { table_name: "no_rls", rls_enabled: false, policies: 0 },
    { table_name: "no_policy", rls_enabled: true, policies: 0 },
  ]);
  assertEquals(r.status, "fail");
  assertEquals(r.findings.length, 2);
  assertEquals(r.findings.find((f) => f.title.includes("no_rls"))?.severity, "critical");
  assertEquals(r.findings.find((f) => f.title.includes("no_policy"))?.severity, "high");
});

Deno.test("auditRetention — overdue rows flagged", () => {
  const r = auditRetention(
    [
      { table_name: "logs", retention_days: 30, row_count: 100, oldest: daysAgo(70) },
      { table_name: "fresh", retention_days: 30, row_count: 100, oldest: daysAgo(20) },
    ],
    NOW,
  );
  assertEquals(r.findings.length, 1);
  assertEquals(r.findings[0].severity, "high");
});

Deno.test("summarise — aggregates severities + worst status", () => {
  const ok = auditSecrets([{ key: "A", updated_at: daysAgo(1) }], NOW);
  const fail = auditAdmins([], [], NOW);
  const agg = summarise([ok, fail]);
  assertEquals(agg.status, "fail");
  assertEquals(agg.summary.critical, 1);
});
