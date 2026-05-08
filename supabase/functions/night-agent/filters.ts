// Query-string parsing for /open?test=1 candidate filters.
import { MAX_JOBS_PER_SHIFT } from "./config.ts";

export type ClassifiedJob = {
  id: string;
  short_num: number;
  title: string;
  risk: string;
  phase: string;
  suite: string;
  would_audit: boolean;
  skip_reasons: string[];
};

export type ParsedFilters = {
  phaseFilter: Set<string>;
  riskFilter: Set<string>;
  verdictFilter: string; // 'audit' | 'skip' | ''
  titleQuery: string;
  shortNums: Set<number>;
  limit: number;
  filtersApplied: {
    phase: string[];
    risk: string[];
    verdict: string | null;
    q: string | null;
    short_num: number[];
    limit: number;
  };
};

export function parseOpenTestFilters(url: URL): ParsedFilters {
  const csv = (k: string) =>
    url.searchParams.getAll(k).flatMap((v) => v.split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const phaseFilter = new Set(csv("phase"));
  const riskFilter = new Set(csv("risk"));
  const verdictFilter = (url.searchParams.get("verdict") ?? "").toLowerCase();
  const titleQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const shortNumsRaw = csv("short_num");
  const shortNums = new Set(shortNumsRaw.map((s) => Number(s)).filter((n) => Number.isFinite(n)));
  const limitParam = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), MAX_JOBS_PER_SHIFT)
    : MAX_JOBS_PER_SHIFT;

  return {
    phaseFilter, riskFilter, verdictFilter, titleQuery, shortNums, limit,
    filtersApplied: {
      phase: Array.from(phaseFilter),
      risk: Array.from(riskFilter),
      verdict: verdictFilter || null,
      q: titleQuery || null,
      short_num: Array.from(shortNums),
      limit,
    },
  };
}

export function applyDerivedFilters(classified: ClassifiedJob[], f: ParsedFilters): ClassifiedJob[] {
  return classified.filter((j) => {
    if (f.phaseFilter.size > 0 && !f.phaseFilter.has(j.phase)) return false;
    if (f.riskFilter.size > 0 && !f.riskFilter.has(j.risk)) return false;
    if (f.verdictFilter === "audit" && !j.would_audit) return false;
    if (f.verdictFilter === "skip" && j.would_audit) return false;
    return true;
  });
}
