// Detects likely PII or secrets in lesson text. Used on both client and server.
// Keep server copy in supabase/functions/awip-api/lessonSafety.ts in sync.

export type SafetyIssue = { kind: string; match: string; index: number };

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "phone", re: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/g },
  { kind: "credit_card", re: /\b(?:\d[ -]*?){13,19}\b/g },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
  { kind: "ssn_us", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  { kind: "openai_key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { kind: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { kind: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe_key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { kind: "private_key_block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { kind: "supabase_service_role", re: /\bservice_role\b/gi },
  { kind: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
];

const KIND_LABELS: Record<string, string> = {
  email: "email address",
  phone: "phone number",
  credit_card: "credit card number",
  iban: "IBAN",
  ssn_us: "US SSN",
  jwt: "JWT",
  openai_key: "OpenAI API key",
  anthropic_key: "Anthropic API key",
  google_api_key: "Google API key",
  github_token: "GitHub token",
  aws_access_key: "AWS access key",
  slack_token: "Slack token",
  stripe_key: "Stripe key",
  private_key_block: "private key block",
  supabase_service_role: "service_role reference",
  bearer_token: "Bearer token",
};

function luhnValid(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export function scanLesson(text: string): SafetyIssue[] {
  if (!text) return [];
  const issues: SafetyIssue[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const match = m[0];
      if (kind === "credit_card" && !luhnValid(match)) continue;
      // phone false-positive: skip if it overlaps a credit card / iban-like very long digit run
      if (kind === "phone" && match.replace(/\D/g, "").length > 12) continue;
      issues.push({ kind, match, index: m.index });
    }
  }
  return issues;
}

export function describeIssues(issues: SafetyIssue[]): string {
  const kinds = Array.from(new Set(issues.map((i) => KIND_LABELS[i.kind] ?? i.kind)));
  return kinds.join(", ");
}
