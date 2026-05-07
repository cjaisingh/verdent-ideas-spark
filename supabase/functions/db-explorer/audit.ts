// Pure audit helpers extracted from index.ts so they can be unit-tested
// without booting the Deno HTTP server.

export interface AuditEntry {
  ts: string;
  request_id: string;
  user_id: string | null;
  action: string | null;
  table: string | null;
  limit: number | null;
  offset: number | null;
  status: number;
  result_count: number | null;
  duration_ms: number;
  error_code: string | null;
  rejected: boolean;
  rejection_reason: string | null;
  requested: Record<string, unknown> | null;
}

const SENSITIVE_KEY_RE = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|session|jwt|bearer|x-awip-service-token)/i;
const SENSITIVE_VALUE_RES: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(sk|pk|rk|sbp)_[A-Za-z0-9]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/i,
];
const MAX_STRING_LEN = 200;
const MAX_DEPTH = 4;

export function redactValue(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === "string") {
    for (const re of SENSITIVE_VALUE_RES) if (re.test(v)) return "[REDACTED]";
    return v.length > MAX_STRING_LEN ? v.slice(0, MAX_STRING_LEN) + "…" : v;
  }
  if (typeof v !== "object") return v;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redactValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : redactValue(val, depth + 1);
  }
  return out;
}

export function redactErrorMessage(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const cleaned = msg
    .replace(/\bpostgres:\/\/[^\s'"]+/gi, "[REDACTED_DSN]")
    .replace(/\bhttps?:\/\/[^\s'"]+/gi, "[REDACTED_URL]");
  for (const re of SENSITIVE_VALUE_RES) if (re.test(cleaned)) return "[REDACTED]";
  return cleaned.length > 120 ? cleaned.slice(0, 120) + "…" : cleaned;
}

export function resultCount(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return Object.keys(data).length;
  return null;
}

export interface AuditContext {
  requestId: string;
  userId: string | null;
  action: string | null;
  table: string | null;
  limit: number | null;
  offset: number | null;
  startedAt: number;
  requested: Record<string, unknown> | null;
}

export function buildAuditEntry(
  ctx: AuditContext,
  status: number,
  errorCode: string | null,
  resultCnt: number | null,
  rejection?: { reason: string; requested?: Record<string, unknown> | null },
  now: number = Date.now(),
): AuditEntry {
  const rejected = !!rejection || status >= 400;
  const raw: AuditEntry = {
    ts: new Date(now).toISOString(),
    request_id: ctx.requestId,
    user_id: ctx.userId,
    action: ctx.action,
    table: ctx.table,
    limit: ctx.limit,
    offset: ctx.offset,
    status,
    result_count: resultCnt,
    duration_ms: now - ctx.startedAt,
    error_code: errorCode,
    rejected,
    rejection_reason: rejection?.reason ?? (rejected ? errorCode : null),
    requested: rejection?.requested ?? (rejected ? ctx.requested : null),
  };
  return {
    ...raw,
    rejection_reason: redactErrorMessage(raw.rejection_reason),
    error_code: redactErrorMessage(raw.error_code),
    requested: raw.requested ? (redactValue(raw.requested) as Record<string, unknown>) : null,
  };
}
