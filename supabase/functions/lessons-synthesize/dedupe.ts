// Pure dedupe / normalisation helpers for lessons-synthesize.
// AI prompt + DB IO live in index.ts; the helpers below are unit-tested.

export type RawLesson = {
  category?: string;
  severity?: string;
  title?: string;
  recommendation?: string;
  evidence?: unknown[];
};

export type NormalisedLesson = {
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  recommendation: string;
  evidence: unknown[];
  dedupe_key: string;
};

const SEV_MAP: Record<string, NormalisedLesson["severity"]> = {
  info: "low", low: "low", minor: "low",
  med: "medium", medium: "medium", moderate: "medium",
  high: "high", major: "high",
  crit: "critical", critical: "critical", severe: "critical",
};

function slug(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function dedupeKey(category: string, title: string): string {
  return `${slug(category)}::${slug(title)}`;
}

export function normaliseLesson(raw: RawLesson): NormalisedLesson | null {
  const category = (raw.category ?? "").toString().trim() || "general";
  const title = (raw.title ?? "").toString().trim();
  const recommendation = (raw.recommendation ?? "").toString().trim();
  if (!title || !recommendation) return null;
  const sevRaw = (raw.severity ?? "medium").toString().toLowerCase().trim();
  const severity = SEV_MAP[sevRaw] ?? "medium";
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.slice(0, 20) : [];
  return {
    category,
    severity,
    title: title.slice(0, 200),
    recommendation: recommendation.slice(0, 2000),
    evidence,
    dedupe_key: dedupeKey(category, title),
  };
}

export function dedupeLessons(rows: RawLesson[]): NormalisedLesson[] {
  const seen = new Map<string, NormalisedLesson>();
  for (const r of rows) {
    const n = normaliseLesson(r);
    if (!n) continue;
    if (!seen.has(n.dedupe_key)) seen.set(n.dedupe_key, n);
  }
  return [...seen.values()];
}
