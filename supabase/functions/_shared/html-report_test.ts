import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml, renderAuditReport, renderReviewReport } from "../_shared/html-report.ts";

Deno.test("escapeHtml escapes the standard five entities", () => {
  assertEquals(escapeHtml(`<a href="x">'O&M'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;O&amp;M&#39;&lt;/a&gt;");
});

Deno.test("renderAuditReport produces self-contained HTML with inline SVG and escaped content", () => {
  const html = renderAuditReport({
    run_id: "run-123",
    cadence: "weekly",
    started_at: "2026-06-16T04:00:00Z",
    finished_at: "2026-06-16T04:00:42Z",
    status: "warn",
    summary: { high: 1, critical: 0 },
    findings: [
      { severity: "high", title: "<bad>tag</bad>", module: "rls", detail: "needs policy", recommendation: "add policy" },
      { severity: "low", title: "ok finding", module: "secrets" },
    ],
  });
  assertStringIncludes(html, "<!doctype html>");
  assertStringIncludes(html, "<svg");
  assertStringIncludes(html, "weekly deep audit");
  // XSS-escaped
  assertStringIncludes(html, "&lt;bad&gt;tag&lt;/bad&gt;");
  assert(!html.includes("<bad>"), "raw tag must not appear");
  // No external assets
  assert(!html.includes("http://") && !html.includes("https://"), "must be self-contained");
});

Deno.test("renderReviewReport handles empty findings cleanly", () => {
  const html = renderReviewReport({
    review_id: "rev-1",
    review_date: "2026-06-15",
    reviewer: "hermes-agent",
    scope: "weekly",
    summary: "Quiet week.",
    source_repo: "cjaisingh/verdent-ideas-spark",
    source_path: "docs/reviews/2026-06-15.md",
    file_sha: "abcdef0123456789",
    findings: [],
  });
  assertStringIncludes(html, "External review");
  assertStringIncludes(html, "No findings");
  assertStringIncludes(html, "Quiet week.");
  assertStringIncludes(html, "abcdef01");
});

Deno.test("renderAuditReport groups findings by module via second chart", () => {
  const html = renderAuditReport({
    run_id: "run-x",
    cadence: "monthly",
    started_at: "2026-06-16T04:00:00Z",
    status: "fail",
    summary: {},
    findings: [
      { severity: "critical", title: "a", module: "rls" },
      { severity: "high", title: "b", module: "rls" },
      { severity: "medium", title: "c", module: "secrets" },
    ],
  });
  // Two SVGs: severity + module breakdown
  const svgCount = (html.match(/<svg/g) ?? []).length;
  assertEquals(svgCount >= 2, true);
});
