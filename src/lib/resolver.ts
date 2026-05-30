// Resolver helpers shared by UI + tests. Pure functions, no I/O.

export type ResolverBand = "auto_bind" | "conflict" | "no_match";

export interface BandThresholds {
  auto_bind: number;
  conflict: number;
  no_match: number;
}

/** Map a numeric confidence score to a band using live thresholds. */
export function bandFor(score: number, t: BandThresholds): ResolverBand {
  if (score >= t.auto_bind) return "auto_bind";
  if (score >= t.conflict) return "conflict";
  return "no_match";
}

/** Validate that thresholds are strictly decreasing in band order. */
export function isMonotonic(t: BandThresholds): boolean {
  return (
    Number.isFinite(t.auto_bind) &&
    Number.isFinite(t.conflict) &&
    Number.isFinite(t.no_match) &&
    t.auto_bind > t.conflict &&
    t.conflict > t.no_match &&
    t.no_match >= 0 &&
    t.auto_bind <= 1
  );
}
