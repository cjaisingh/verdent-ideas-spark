// Shared HTML report renderer for Deep Audit + AWIP Reviews.
// Pure string templating. No external assets. Inline CSS + SVG only.
// All user/finding-derived strings go through escapeHtml.

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface ReportFinding {
  severity: Severity;
  title: string;
  area?: string | null;
  module?: string | null;
  detail?: string | null;
  recommendation?: string | null;
}

export interface AuditReportInput {
  run_id: string;
  cadence: string;
  started_at: string;
  finished_at?: string | null;
  status: string;
  summary: Record<string, number | string | undefined> | null;
  findings: ReportFinding[];
  app_origin?: string;
}

export interface ReviewReportInput {
  review_id: string;
  review_date?: string | null;
  reviewer?: string | null;
  scope?: string | null;
  summary?: string | null;
  source_repo?: string | null;
  source_path?: string | null;
  file_sha?: string | null;
  findings: ReportFinding[];
  app_origin?: string;
}

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEV_COLOR: Record<Severity, string> = {
  critical: "#b91c1c",
  high: "#dc2626",
  medium: "#d97706",
  low: "#64748b",
  info: "#94a3b8",
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countBySeverity(findings: ReportFinding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const s = (SEV_ORDER as string[]).includes(f.severity) ? f.severity : "info";
    out[s as Severity]++;
  }
  return out;
}

function severityBarChart(counts: Record<Severity, number>): string {
  const max = Math.max(1, ...Object.values(counts));
  const barW = 80;
  const gap = 20;
  const chartH = 140;
  const padTop = 20;
  const padBottom = 30;
  const width = SEV_ORDER.length * (barW + gap) + gap;
  const height = chartH + padTop + padBottom;

  const bars = SEV_ORDER.map((sev, i) => {
    const n = counts[sev];
    const h = Math.round((n / max) * chartH);
    const x = gap + i * (barW + gap);
    const y = padTop + (chartH - h);
    const label = `${n}`;
    return `
      <g>
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${SEV_COLOR[sev]}" rx="3" />
        <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle"
              font-family="system-ui, sans-serif" font-size="13" fill="#0f172a" font-weight="600">${label}</text>
        <text x="${x + barW / 2}" y="${padTop + chartH + 20}" text-anchor="middle"
              font-family="system-ui, sans-serif" font-size="12" fill="#475569">${sev}</text>
      </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
              xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Findings by severity">
    ${bars}
  </svg>`;
}

function groupByCategoryChart(findings: ReportFinding[], picker: (f: ReportFinding) => string | null | undefined): string {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const k = (picker(f) || "unknown").toString();
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return "";
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const rowH = 26;
  const labelW = 160;
  const barMaxW = 360;
  const height = entries.length * rowH + 10;
  const width = labelW + barMaxW + 60;
  const rows = entries.map(([k, n], i) => {
    const y = i * rowH + 18;
    const w = Math.max(2, Math.round((n / max) * barMaxW));
    return `
      <g>
        <text x="0" y="${y}" font-family="system-ui, sans-serif" font-size="12" fill="#334155">${escapeHtml(k.slice(0, 22))}</text>
        <rect x="${labelW}" y="${y - 12}" width="${w}" height="16" fill="#0ea5e9" rx="2" />
        <text x="${labelW + w + 6}" y="${y}" font-family="system-ui, sans-serif" font-size="12" fill="#0f172a">${n}</text>
      </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
              xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Findings by area">
    ${rows}
  </svg>`;
}

function sevChip(sev: Severity): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${SEV_COLOR[sev]};color:#fff;font-size:11px;font-weight:600;text-transform:uppercase">${escapeHtml(sev)}</span>`;
}

function sortFindings(findings: ReportFinding[]): ReportFinding[] {
  return [...findings].sort(
    (a, b) => SEV_ORDER.indexOf(a.severity as Severity) - SEV_ORDER.indexOf(b.severity as Severity),
  );
}

function findingsTable(findings: ReportFinding[], categoryLabel: string): string {
  if (findings.length === 0) {
    return `<p style="color:#64748b;font-style:italic">No findings — clean run.</p>`;
  }
  const rows = sortFindings(findings).map((f) => {
    const sev = (SEV_ORDER as string[]).includes(f.severity) ? (f.severity as Severity) : "info";
    const cat = f.area || f.module || "";
    return `
      <tr>
        <td style="padding:8px 10px;vertical-align:top">${sevChip(sev)}</td>
        <td style="padding:8px 10px;vertical-align:top;color:#475569;font-size:12px">${escapeHtml(cat)}</td>
        <td style="padding:8px 10px;vertical-align:top">
          <div style="font-weight:600;color:#0f172a">${escapeHtml(f.title)}</div>
          ${f.detail ? `<div style="font-size:13px;color:#475569;margin-top:2px">${escapeHtml(f.detail)}</div>` : ""}
          ${f.recommendation ? `<div style="font-size:13px;color:#0f172a;margin-top:4px">→ ${escapeHtml(f.recommendation)}</div>` : ""}
        </td>
      </tr>`;
  }).join("");
  return `
    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif">
      <thead>
        <tr style="text-align:left;border-bottom:1px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">
          <th style="padding:6px 10px">Severity</th>
          <th style="padding:6px 10px">${escapeHtml(categoryLabel)}</th>
          <th style="padding:6px 10px">Finding</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const CSS = `
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}
  .wrap{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  header{padding:20px 24px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#f1f5f9,#fff)}
  h1{font-size:22px;margin:0 0 4px}
  .meta{color:#64748b;font-size:13px;display:flex;gap:12px;flex-wrap:wrap}
  .meta code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px}
  section{padding:20px 24px;border-bottom:1px solid #f1f5f9}
  section:last-child{border-bottom:none}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:0 0 12px}
  .pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#e2e8f0;color:#0f172a}
  .pill.ok{background:#dcfce7;color:#166534}
  .pill.warn{background:#fef3c7;color:#92400e}
  .pill.fail{background:#fee2e2;color:#991b1b}
  footer{padding:12px 24px;color:#94a3b8;font-size:11px;background:#f8fafc}
`;

function statusPill(status: string): string {
  const cls = status === "ok" ? "ok" : status === "warn" ? "warn" : status === "fail" ? "fail" : "";
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}

export function renderAuditReport(input: AuditReportInput): string {
  const counts = countBySeverity(input.findings);
  const title = `${input.cadence} deep audit — ${input.started_at.slice(0, 10)}`;
  const subjectId = escapeHtml(input.run_id);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>Status ${statusPill(input.status)}</span>
      <span>Run <code>${subjectId}</code></span>
      <span>Started ${escapeHtml(input.started_at)}</span>
      ${input.finished_at ? `<span>Finished ${escapeHtml(input.finished_at)}</span>` : ""}
    </div>
  </header>
  <section>
    <h2>Findings by severity</h2>
    ${severityBarChart(counts)}
  </section>
  ${input.findings.length > 0 ? `
  <section>
    <h2>Findings by module</h2>
    ${groupByCategoryChart(input.findings, (f) => f.module ?? null)}
  </section>` : ""}
  <section>
    <h2>Findings (${input.findings.length})</h2>
    ${findingsTable(input.findings, "Module")}
  </section>
  <footer>
    Source of truth: <code>public.deep_audit_runs.id = ${subjectId}</code>.
    Findings live on that row as JSONB. Markdown / DB rows remain the system of record; this HTML is a renderable view.
  </footer>
</div>
</body></html>`;
}

export function renderReviewReport(input: ReviewReportInput): string {
  const counts = countBySeverity(input.findings);
  const dateLabel = input.review_date ?? input.review_id.slice(0, 8);
  const title = `External review — ${dateLabel}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      ${input.reviewer ? `<span>Reviewer ${escapeHtml(input.reviewer)}</span>` : ""}
      ${input.scope ? `<span>Scope ${escapeHtml(input.scope)}</span>` : ""}
      <span>Review <code>${escapeHtml(input.review_id)}</code></span>
      ${input.source_repo ? `<span>Source <code>${escapeHtml(input.source_repo)}/${escapeHtml(input.source_path ?? "")}</code></span>` : ""}
      ${input.file_sha ? `<span>SHA <code>${escapeHtml(input.file_sha.slice(0, 8))}</code></span>` : ""}
    </div>
  </header>
  ${input.summary ? `
  <section>
    <h2>Summary</h2>
    <p style="margin:0;color:#0f172a;line-height:1.55">${escapeHtml(input.summary)}</p>
  </section>` : ""}
  <section>
    <h2>Findings by severity</h2>
    ${severityBarChart(counts)}
  </section>
  ${input.findings.length > 0 ? `
  <section>
    <h2>Findings by area</h2>
    ${groupByCategoryChart(input.findings, (f) => f.area ?? null)}
  </section>` : ""}
  <section>
    <h2>Findings (${input.findings.length})</h2>
    ${findingsTable(input.findings, "Area")}
  </section>
  <footer>
    Source of truth: <code>public.awip_reviews.id = ${escapeHtml(input.review_id)}</code> +
    <code>public.awip_review_findings.review_id = ${escapeHtml(input.review_id)}</code>.
    Markdown remains the system of record; this HTML is a renderable view.
  </footer>
</div>
</body></html>`;
}
