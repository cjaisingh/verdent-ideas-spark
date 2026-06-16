// Pull weekly review markdown files from a GitHub repo (docs/reviews/*.md),
// store + parse them, index findings into RAG, open sentinel findings for
// high/critical, and create discussion_actions for actionable items.
//
// Auth: x-awip-service-token (cron) or operator JWT (manual).
// GET  /        → small status payload
// POST /pull    → run pipeline (idempotent)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { withLogger } from "../_shared/logger.ts";
import { pickModel } from "../_shared/model-policy.ts";
import { logAiCall } from "../_shared/ai-usage.ts";
import { renderReviewReport, type ReportFinding } from "../_shared/html-report.ts";


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
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const REPO_OWNER = "cjaisingh";
const REPO_NAME = "verdent-ideas-spark";
const REPO_PATH = "docs/reviews";
const REPO_REF = "main";
const REPO = `${REPO_OWNER}/${REPO_NAME}`;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

type Severity = "info" | "low" | "medium" | "high" | "critical";
const SEV_TO_PRIORITY: Record<Severity, string> = {
  critical: "urgent",
  high: "high",
  medium: "med",
  low: "low",
  info: "low",
};

interface ParsedFinding {
  id?: string;
  title: string;
  severity: Severity;
  area?: string;
  recommendation?: string;
  evidence?: string;
  actionable?: boolean;
}
interface ParsedReview {
  review_date?: string;
  reviewer?: string;
  scope?: string;
  summary?: string;
  findings: ParsedFinding[];
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "awip-reviews-pull",
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

async function listReviewFiles() {
  const url =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${REPO_PATH}?ref=${REPO_REF}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) {
    throw new Error(
      `GitHub 404 listing ${REPO}/${REPO_PATH}. Repo may be private — set GITHUB_REVIEWS_TOKEN.`,
    );
  }
  if (!res.ok) throw new Error(`GitHub list failed: ${res.status} ${await res.text()}`);
  const items = (await res.json()) as Array<
    { name: string; path: string; sha: string; type: string; download_url: string }
  >;
  return items.filter((i) => i.type === "file" && i.name.toLowerCase().endsWith(".md"));
}

async function fetchRaw(path: string, sha: string): Promise<string> {
  // Prefer raw.githubusercontent for public; fallback to contents API blob.
  const rawUrl =
    `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_REF}/${path}`;
  const res = await fetch(rawUrl, { headers: ghHeaders() });
  if (res.ok) return await res.text();
  // Fallback to blob via contents API.
  const blobUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${sha}`;
  const r2 = await fetch(blobUrl, { headers: ghHeaders() });
  if (!r2.ok) throw new Error(`raw fetch failed: ${res.status}, blob ${r2.status}`);
  const b = await r2.json();
  if (b.encoding === "base64") return atob(b.content.replace(/\n/g, ""));
  return b.content ?? "";
}

function normSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (v === "info" || v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return "info";
}

function parseFrontmatter(md: string): { fm: Record<string, unknown> | null; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: md };
  try {
    const fm = parseYaml(m[1]) as Record<string, unknown>;
    return { fm, body: m[2] };
  } catch {
    return { fm: null, body: md };
  }
}

function fromFrontmatter(fm: Record<string, unknown>): ParsedReview {
  const findings = Array.isArray(fm.findings)
    ? (fm.findings as Array<Record<string, unknown>>).map((f) => ({
      id: f.id ? String(f.id) : undefined,
      title: String(f.title ?? "Untitled finding"),
      severity: normSeverity(f.severity),
      area: f.area ? String(f.area) : undefined,
      recommendation: f.recommendation ? String(f.recommendation) : undefined,
      evidence: f.evidence ? String(f.evidence) : undefined,
      actionable: f.actionable === undefined ? true : Boolean(f.actionable),
    }))
    : [];
  return {
    review_date: fm.review_date ? String(fm.review_date) : undefined,
    reviewer: fm.reviewer ? String(fm.reviewer) : undefined,
    scope: fm.scope ? String(fm.scope) : undefined,
    summary: fm.summary ? String(fm.summary) : undefined,
    findings,
  };
}

async function aiExtract(md: string, filename: string): Promise<ParsedReview> {
  if (!LOVABLE_API_KEY) return { findings: [] };
  const model = pickModel("google/gemini-2.5-flash");
  const sys =
    `Extract a structured review from a markdown file. Return STRICT JSON ONLY:
{"review_date":"YYYY-MM-DD"|null,"reviewer":string|null,"scope":string|null,"summary":string|null,
"findings":[{"id":string|null,"title":string,"severity":"info|low|medium|high|critical",
"area":string|null,"recommendation":string|null,"evidence":string|null,"actionable":boolean}]}`;
  const t0 = Date.now();
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `File: ${filename}\n\n${md.slice(0, 12000)}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const txt = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(txt); } catch { /* not json */ }
    await logAiCall(admin, {
      job: "awip-reviews-pull",
      model,
      trigger: "service",
      startedAt: t0,
      response: res,
      json: data as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } },
      request_ref: { filename },
    }).catch(() => {});
    if (!res.ok) return { findings: [] };
    const content = (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<ParsedReview>;
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.map((f: ParsedFinding) => ({
        ...f,
        severity: normSeverity(f.severity),
        actionable: f.actionable === undefined ? true : Boolean(f.actionable),
      }))
      : [];
    return { ...parsed, findings } as ParsedReview;
  } catch {
    return { findings: [] };
  }
}

function chunkContent(text: string, max = 1400) {
  const out: { heading: string | null; content: string; ord: number }[] = [];
  for (let i = 0, ord = 0; i < text.length; i += max, ord++) {
    out.push({ heading: null, content: text.slice(i, i + max), ord });
  }
  return out;
}

async function indexFindingInRag(
  reviewDate: string | null,
  fileBase: string,
  finding: ParsedFinding,
  extId: string,
): Promise<string | null> {
  const path = `reviews/${reviewDate ?? "undated"}/${fileBase}#${extId}`;
  const title = finding.title.slice(0, 200);
  const content = [
    finding.area ? `Area: ${finding.area}` : "",
    `Severity: ${finding.severity}`,
    finding.recommendation ? `Recommendation: ${finding.recommendation}` : "",
    finding.evidence ? `Evidence: ${finding.evidence}` : "",
  ].filter(Boolean).join("\n\n");
  const { data: doc, error } = await admin.from("awip_docs").upsert(
    { path, title, source: "review", updated_at: new Date().toISOString() },
    { onConflict: "path" },
  ).select("id").single();
  if (error || !doc) return null;
  await admin.from("awip_doc_chunks").delete().eq("doc_id", doc.id);
  const rows = chunkContent(`${title}\n\n${content}`).map((c) => ({ doc_id: doc.id, ...c }));
  if (rows.length) await admin.from("awip_doc_chunks").insert(rows);
  return doc.id;
}

async function authorize(req: Request): Promise<{ kind: "service" } | { kind: "operator"; uid: string } | null> {
  const svc = req.headers.get("x-awip-service-token") ?? req.headers.get("x-service-token");
  if (svc && SERVICE_TOKEN && svc === SERVICE_TOKEN) return { kind: "service" };
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles?.some((r) => r.role === "operator" || r.role === "admin")) return null;
  return { kind: "operator", uid: data.user.id };
}

async function recordRun(trigger: string, startedAt: number, status: string, code: number, msg: string, detail: Record<string, unknown> = {}) {
  try {
    await admin.from("automation_runs").insert({
      job: "awip-reviews-pull",
      trigger,
      status,
      status_code: code,
      duration_ms: Date.now() - startedAt,
      message: msg,
      detail,
    });
  } catch (e) {
    console.error("automation_runs insert failed", e);
  }
}

async function processOneFile(
  file: { name: string; path: string; sha: string },
): Promise<{ inserted: boolean; new_findings: number; actions: number; sentinel: number; rag: number; error?: string }> {
  // Dedupe by (repo, path, sha)
  const { data: existing } = await admin.from("awip_reviews")
    .select("id").eq("source_repo", REPO).eq("source_path", file.path).eq("file_sha", file.sha).maybeSingle();
  if (existing) return { inserted: false, new_findings: 0, actions: 0, sentinel: 0, rag: 0 };

  let raw: string;
  try {
    raw = await fetchRaw(file.path, file.sha);
  } catch (e) {
    return { inserted: false, new_findings: 0, actions: 0, sentinel: 0, rag: 0, error: (e as Error).message };
  }

  // Parse
  const { fm } = parseFrontmatter(raw);
  let parsed: ParsedReview;
  if (fm && (Array.isArray(fm.findings) || fm.summary)) {
    parsed = fromFrontmatter(fm);
  } else {
    parsed = await aiExtract(raw, file.name);
  }

  // Insert review row
  const { data: review, error: reviewErr } = await admin.from("awip_reviews").insert({
    source_repo: REPO,
    source_path: file.path,
    file_sha: file.sha,
    review_date: parsed.review_date ?? null,
    reviewer: parsed.reviewer ?? null,
    scope: parsed.scope ?? "weekly",
    summary: parsed.summary ?? null,
    raw_markdown: raw,
    parsed: parsed as unknown as Record<string, unknown>,
    process_status: "pending",
  }).select("id").single();
  if (reviewErr || !review) {
    return { inserted: false, new_findings: 0, actions: 0, sentinel: 0, rag: 0, error: reviewErr?.message ?? "review insert failed" };
  }

  let actions = 0, sentinel = 0, rag = 0;
  const fileBase = file.name.replace(/\.md$/i, "");

  for (let i = 0; i < parsed.findings.length; i++) {
    const f = parsed.findings[i];
    const extId = f.id ?? `f${i + 1}`;
    const dedupeKey = `review:${REPO}:${file.path}:${extId}`;

    // RAG index (always)
    const ragDocId = await indexFindingInRag(parsed.review_date ?? null, fileBase, f, extId);
    if (ragDocId) rag++;

    // Sentinel for high/critical
    let sentinelId: string | null = null;
    if (f.severity === "high" || f.severity === "critical") {
      const { data: s } = await admin.from("sentinel_findings").upsert({
        kind: "review_finding",
        severity: f.severity,
        summary: f.title.slice(0, 280),
        subject_ref: { review_id: review.id, ext_id: extId, area: f.area ?? null },
        payload: { recommendation: f.recommendation ?? null, evidence: f.evidence ?? null, file: file.path },
        dedupe_key: dedupeKey,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "dedupe_key" }).select("id").single();
      sentinelId = s?.id ?? null;
      if (sentinelId) sentinel++;
    }

    // Discussion action for actionable
    let actionId: string | null = null;
    if (f.actionable !== false) {
      const details = [
        f.area ? `Area: ${f.area}` : "",
        f.recommendation ? `Recommendation: ${f.recommendation}` : "",
        f.evidence ? `Evidence: ${f.evidence}` : "",
        `Source: ${file.path}`,
      ].filter(Boolean).join("\n\n");
      const { data: a } = await admin.from("discussion_actions").insert({
        subject_type: "awip_review",
        subject_id: review.id,
        title: f.title.slice(0, 200),
        details,
        priority: SEV_TO_PRIORITY[f.severity],
        source: "extracted",
        extracted_confidence: 0.9,
        night_eligible: true,
        status: "open",
      }).select("id").single();
      actionId = a?.id ?? null;
      if (actionId) actions++;
    }

    await admin.from("awip_review_findings").insert({
      review_id: review.id,
      ext_id: extId,
      title: f.title,
      severity: f.severity,
      area: f.area ?? null,
      recommendation: f.recommendation ?? null,
      evidence: f.evidence ?? null,
      actionable: f.actionable !== false,
      discussion_action_id: actionId,
      sentinel_finding_id: sentinelId,
      rag_doc_id: ragDocId,
    });
  }

  // Render self-contained HTML report and upload. Non-fatal on failure.
  let reportPath: string | null = null;
  try {
    const reportFindings: ReportFinding[] = parsed.findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      area: f.area ?? null,
      recommendation: f.recommendation ?? null,
      detail: f.evidence ?? null,
    }));
    const html = renderReviewReport({
      review_id: review.id,
      review_date: parsed.review_date ?? null,
      reviewer: parsed.reviewer ?? null,
      scope: parsed.scope ?? null,
      summary: parsed.summary ?? null,
      source_repo: REPO,
      source_path: file.path,
      file_sha: file.sha,
      findings: reportFindings,
    });
    const path = `awip-reviews/${review.id}.html`;
    const { error: upErr } = await admin.storage.from("audit-reports").upload(
      path,
      new Blob([html], { type: "text/html" }),
      { upsert: true, contentType: "text/html" },
    );
    if (upErr) console.error("audit-reports upload failed", upErr.message);
    else reportPath = path;
  } catch (e) {
    console.error("renderReviewReport failed", e);
  }

  await admin.from("awip_reviews").update({
    processed_at: new Date().toISOString(),
    process_status: "processed",
    report_html_path: reportPath,
  }).eq("id", review.id);

  return { inserted: true, new_findings: parsed.findings.length, actions, sentinel, rag };
}


async function appendToTodayMorningReview(summary: Record<string, unknown>, perFile: Array<Record<string, unknown>>) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: mr } = await admin.from("morning_reviews")
    .select("id, revisit_items").eq("review_date", today).maybeSingle();
  const entry = {
    kind: "weekly_reviews",
    pulled_at: new Date().toISOString(),
    ...summary,
    files: perFile,
  };
  if (mr) {
    const items = Array.isArray(mr.revisit_items) ? [...mr.revisit_items, entry] : [entry];
    await admin.from("morning_reviews").update({ revisit_items: items }).eq("id", mr.id);
  } else {
    await admin.from("morning_reviews").insert({
      review_date: today,
      revisit_items: [entry],
      generated_by: "awip-reviews-pull",
    });
  }
}

Deno.serve(withLogger("awip-reviews-pull", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/awip-reviews-pull/, "") || "/";

  const who = await authorize(req);
  if (!who) return json({ error: "unauthorized" }, 401);

  const trigger = (await (async () => {
    const svc = req.headers.get("x-awip-service-token") ?? req.headers.get("x-service-token");
    return svc && SERVICE_TOKEN && svc === SERVICE_TOKEN ? "cron" : "manual";
  })());

  if (req.method === "GET") {
    const { count } = await admin.from("awip_reviews").select("*", { count: "exact", head: true });
    const { data: latest } = await admin.from("awip_reviews")
      .select("review_date, reviewer, summary, fetched_at, process_status")
      .order("fetched_at", { ascending: false }).limit(5);
    return json({ ok: true, repo: REPO, path: REPO_PATH, total: count ?? 0, latest: latest ?? [] });
  }

  if (path === "/pull" && req.method === "POST") {
    const startedAt = Date.now();
    try {
      const files = await listReviewFiles();
      const perFile: Array<Record<string, unknown>> = [];
      let newFiles = 0, totalFindings = 0, totalActions = 0, totalSentinel = 0, totalRag = 0, errors = 0;
      for (const f of files) {
        const r = await processOneFile(f);
        if (r.error) { errors++; perFile.push({ file: f.path, error: r.error }); continue; }
        if (r.inserted) {
          newFiles++;
          totalFindings += r.new_findings;
          totalActions += r.actions;
          totalSentinel += r.sentinel;
          totalRag += r.rag;
          perFile.push({
            file: f.path,
            findings: r.new_findings,
            actions: r.actions,
            sentinel: r.sentinel,
            rag: r.rag,
          });
        }
      }
      const summary = {
        scanned: files.length,
        new_files: newFiles,
        findings_created: totalFindings,
        actions_created: totalActions,
        sentinel_opened: totalSentinel,
        rag_indexed: totalRag,
        errors,
      };
      if (newFiles > 0) await appendToTodayMorningReview(summary, perFile);
      await recordRun(trigger, startedAt, errors > 0 ? "warn" : "ok", 200, `pulled ${newFiles}/${files.length}`, summary);
      return json({ ok: true, ...summary, files: perFile });
    } catch (e) {
      const msg = (e as Error).message;
      await recordRun(trigger, startedAt, "error", 500, msg);
      return json({ error: msg }, 500);
    }
  }

  return json({ error: "not_found", path }, 404);
}));
