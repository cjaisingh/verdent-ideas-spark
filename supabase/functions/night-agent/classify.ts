// Pure classification helpers used by /open and /open?test=1.

export const SEV_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3 };
export const worse = (a: string, b: string) => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);

export function classifyJob(j: { title: string; details: string | null; priority: string }) {
  const text = `${j.title} ${j.details ?? ""}`.toLowerCase();
  if (/\b(security|auth|payment|delete|drop|migration|prod)\b/.test(text)) {
    return { risk: "high" as const, reason: "keyword match (security/auth/payment/delete/migration/prod)" };
  }
  if (j.priority === "high") return { risk: "high" as const, reason: "priority=high" };
  if (j.priority === "low") return { risk: "low" as const, reason: "priority=low" };
  return { risk: "med" as const, reason: "default" };
}

// Inferred phase + suite hints. Cheap keyword match; falls back to 'general'.
export function inferPhaseAndSuite(title: string) {
  const t = title.toLowerCase();
  let phase = "general";
  if (/\b(auth|login|jwt|role)\b/.test(t)) phase = "auth";
  else if (/\b(roadmap|finding|risk)\b/.test(t)) phase = "roadmap";
  else if (/\b(copilot|voice|telegram)\b/.test(t)) phase = "copilot";
  else if (/\b(jobs?|discussion|action)\b/.test(t)) phase = "jobs";
  return { phase, suite: phase };
}
