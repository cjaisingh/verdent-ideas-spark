// Structured diagnostic logger for e2e tests.
//
// Emits one JSON object per line, prefixed with `E2E_DIAG ` so CI workflow
// steps can grep/jq them out of the raw log and surface them in the GitHub
// step summary or as a downloadable artifact.
//
// Every payload is run through `redact()` before serialisation so secrets,
// tokens, JWTs, and other sensitive values never reach the CI logs or the
// uploaded `e2e-logs/` artefact.
//
// Shape is stable:
//   {
//     "ts": "<ISO timestamp>",
//     "event": "<short snake_case event id>",
//     "test_file": "<file emitting the diag>",
//     "sqlstate": "<postgres sqlstate or null>",
//     "message": "<error message or null>",
//     "details": "<postgres details or null>",
//     "hint": "<postgres hint or null>",
//     "attempted_row": { ... } | null,   // redacted
//     "extra": { ... } | null            // redacted
//   }
//
// Keep this file dependency-free so it can be imported from any test.

export interface E2EDiag {
  event: string;
  test_file: string;
  sqlstate?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  attempted_row?: Record<string, unknown> | null;
  extra?: Record<string, unknown> | null;
}

const PREFIX = "E2E_DIAG ";
const REDACTED = "[REDACTED]";

// Key names whose values must never appear in logs, regardless of content.
// Matched case-insensitively as a substring against the JSON key.
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word|phrase)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authoriz(ation|ed)/i,
  /bearer/i,
  /cookie/i,
  /session/i,
  /private[_-]?key/i,
  /service[_-]?role/i,
  /anon[_-]?key/i,
  /access[_-]?key/i,
  /refresh[_-]?token/i,
  /signature/i,
  /^otp$/i,
  /^pin$/i,
];

// Value-level patterns: scrub anything that looks like a secret regardless of
// where it shows up (error messages, hint text, nested arrays).
const SENSITIVE_VALUE_PATTERNS: readonly { re: RegExp; label: string }[] = [
  // JWT (header.payload.signature, base64url segments, 2 dots).
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, label: "[REDACTED_JWT]" },
  // Supabase service-role / anon keys start with sb-... or sbp_... etc.
  { re: /\bsb[a-z]?_[A-Za-z0-9_-]{20,}\b/g, label: "[REDACTED_SUPABASE_KEY]" },
  // Generic Bearer headers in free-form text.
  { re: /\bBearer\s+[A-Za-z0-9._\-+/=]{12,}/gi, label: "Bearer [REDACTED]" },
  // OpenAI-style sk-... tokens.
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: "[REDACTED_API_KEY]" },
  // Telegram bot tokens: <digits>:<35+ chars>
  { re: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, label: "[REDACTED_TELEGRAM_TOKEN]" },
  // GitHub PATs (ghp_, gho_, ghu_, ghs_, ghr_).
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, label: "[REDACTED_GITHUB_TOKEN]" },
  // High-entropy long hex (probable signing secret / md5/sha) — 40+ hex chars.
  { re: /\b[a-f0-9]{40,}\b/gi, label: "[REDACTED_HEX]" },
  // Long base64-ish blobs (≥64 chars of base64 alphabet).
  { re: /\b[A-Za-z0-9+/=_-]{64,}\b/g, label: "[REDACTED_LONG_TOKEN]" },
];

function keyLooksSensitive(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function scrubString(value: string): string {
  let out = value;
  for (const { re, label } of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED; // hard recursion cap
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keyLooksSensitive(k)) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  // Functions, symbols, etc. — never serialise.
  return REDACTED;
}

// Exposed for unit tests.
export const __testing__ = { redact, scrubString, keyLooksSensitive };

export function emitDiag(diag: E2EDiag): void {
  const payload = {
    ts: new Date().toISOString(),
    event: diag.event,
    test_file: diag.test_file,
    sqlstate: diag.sqlstate ?? null,
    message: diag.message != null ? scrubString(diag.message) : null,
    details: diag.details != null ? scrubString(diag.details) : null,
    hint: diag.hint != null ? scrubString(diag.hint) : null,
    attempted_row:
      diag.attempted_row != null
        ? (redact(diag.attempted_row) as Record<string, unknown>)
        : null,
    extra:
      diag.extra != null ? (redact(diag.extra) as Record<string, unknown>) : null,
  };
  // Single-line JSON so the CI extractor can rely on one record per line.
  // eslint-disable-next-line no-console
  console.error(PREFIX + JSON.stringify(payload));
}

export const E2E_DIAG_PREFIX = PREFIX;
