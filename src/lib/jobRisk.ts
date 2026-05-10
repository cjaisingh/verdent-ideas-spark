// Shared helpers for the discussion_actions.risk dimension.
// Risk = "blast radius if wrong", separate from priority ("when to do it").
// Critical = never night-shift. High = night-shift only with an override reason.

export type JobRisk = "low" | "med" | "high" | "critical";

export const JOB_RISKS: JobRisk[] = ["low", "med", "high", "critical"];

export const RISK_LABEL: Record<JobRisk, string> = {
  low: "low",
  med: "med",
  high: "high",
  critical: "critical",
};

export const RISK_RUBRIC: Record<JobRisk, string> = {
  low: "Pure docs, comments, lint fixes, semver-patch deps. Night-shift OK.",
  med: "Internal pages, copy, non-destructive refactors. Night-shift OK.",
  high: "Schema, edge-function contracts, customer-visible UX. Day shift (override needed for night).",
  critical: "Auth, billing, RLS, data migrations, anything irreversible. Day shift only — never night.",
};

export const RISK_DOT_CLASS: Record<JobRisk, string> = {
  low: "bg-muted-foreground/40",
  med: "bg-tint-discussion",
  high: "bg-amber-500",
  critical: "bg-destructive",
};

export const RISK_BADGE_CLASS: Record<JobRisk, string> = {
  low: "border-muted-foreground/40 text-muted-foreground",
  med: "border-tint-discussion/60 text-tint-discussion",
  high: "border-amber-500/70 text-amber-600 dark:text-amber-400",
  critical: "border-destructive/70 text-destructive",
};

export function isJobRisk(v: unknown): v is JobRisk {
  return v === "low" || v === "med" || v === "high" || v === "critical";
}

export function nightAllowedFor(risk: JobRisk, overrideReason: string | null | undefined): boolean {
  if (risk === "critical") return false;
  if (risk === "high") return !!overrideReason && overrideReason.trim().length > 0;
  return true;
}

export function nightBlockedReason(risk: JobRisk, overrideReason: string | null | undefined): string | null {
  if (risk === "critical") return "Critical risk — never night-shift. Day shift only.";
  if (risk === "high" && !(overrideReason && overrideReason.trim()))
    return "High risk — add an override reason in the job drawer to allow night shift.";
  return null;
}
