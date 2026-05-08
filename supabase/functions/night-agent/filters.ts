// Strict query-string parsing for /open?test=1 candidate filters.
//
// Contract:
//   - Returns { ok: true, filters } on success, or { ok: false, errors }
//     on any malformed input. The /open?test=1 handler turns errors into
//     a 400 so callers see exactly which param was rejected.
//   - All values are normalised (trimmed, lowercased) before validation.
//   - Empty CSV slices ("?phase=", "?phase=,," are treated as "no
//     filter" — never as a filter on the empty string.
//   - Unknown verdict / risk / phase values are rejected, not silently
//     ignored, so a typo in the operator console surfaces immediately.
//   - short_num accepts only positive integers; floats, negatives,
//     zero, and non-numeric tokens are rejected.
//   - limit must be a positive integer ≤ MAX_JOBS_PER_SHIFT.
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

export type Verdict = "audit" | "skip" | "";

export type ParsedFilters = {
  phaseFilter: Set<string>;
  riskFilter: Set<string>;
  verdictFilter: Verdict;
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

export type ParseResult =
  | { ok: true; filters: ParsedFilters }
  | { ok: false; errors: string[] };

// Allowed values. Phase is open-ended at the schema level (settings
// drive `night_allowed_kinds`), but the filter knob is operator-facing
// and must reject typos — keep it in sync with `inferPhaseAndSuite`.
const ALLOWED_PHASES = new Set(["general", "auth", "roadmap", "copilot", "jobs"]);
const ALLOWED_RISKS = new Set(["low", "med", "high"]);
const ALLOWED_VERDICTS = new Set(["audit", "skip"]);

const MAX_TITLE_QUERY_LEN = 100;
const MAX_SHORT_NUMS = 50;

function csv(url: URL, key: string): string[] {
  // Splits repeated and comma-joined values, trims, lowercases, and
  // drops empty slices so "?phase=" / "?phase=,," collapse to [].
  return url.searchParams
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function isPositiveInt(s: string): boolean {
  // Strict: only digits, no leading zeros padding (we still accept "0"
  // here and reject it below for short_num/limit), no decimals, no
  // sign, no whitespace.
  return /^\d+$/.test(s);
}

export function parseOpenTestFilters(url: URL): ParseResult {
  const errors: string[] = [];

  // ── phase ──────────────────────────────────────────────────────────
  const phaseRaw = csv(url, "phase");
  const phaseFilter = new Set<string>();
  for (const p of phaseRaw) {
    if (!ALLOWED_PHASES.has(p)) {
      errors.push(`phase: '${p}' is not one of ${[...ALLOWED_PHASES].join(", ")}`);
    } else {
      phaseFilter.add(p);
    }
  }

  // ── risk ───────────────────────────────────────────────────────────
  const riskRaw = csv(url, "risk");
  const riskFilter = new Set<string>();
  for (const r of riskRaw) {
    if (!ALLOWED_RISKS.has(r)) {
      errors.push(`risk: '${r}' is not one of ${[...ALLOWED_RISKS].join(", ")}`);
    } else {
      riskFilter.add(r);
    }
  }

  // ── verdict ────────────────────────────────────────────────────────
  const verdictRaw = (url.searchParams.get("verdict") ?? "").trim().toLowerCase();
  let verdictFilter: Verdict = "";
  if (verdictRaw.length > 0) {
    if (!ALLOWED_VERDICTS.has(verdictRaw)) {
      errors.push(`verdict: '${verdictRaw}' must be 'audit' or 'skip'`);
    } else {
      verdictFilter = verdictRaw as Verdict;
    }
  }

  // ── title query ────────────────────────────────────────────────────
  const titleQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (titleQuery.length > MAX_TITLE_QUERY_LEN) {
    errors.push(`q: must be ≤ ${MAX_TITLE_QUERY_LEN} characters`);
  }

  // ── short_num ──────────────────────────────────────────────────────
  const shortRaw = csv(url, "short_num");
  const shortNums = new Set<number>();
  for (const tok of shortRaw) {
    if (!isPositiveInt(tok)) {
      errors.push(`short_num: '${tok}' is not a positive integer`);
      continue;
    }
    const n = Number(tok);
    if (n <= 0) {
      errors.push(`short_num: must be > 0 (got ${tok})`);
      continue;
    }
    shortNums.add(n);
  }
  if (shortNums.size > MAX_SHORT_NUMS) {
    errors.push(`short_num: too many values (max ${MAX_SHORT_NUMS})`);
  }

  // ── limit ──────────────────────────────────────────────────────────
  const limitRaw = url.searchParams.get("limit");
  let limit = MAX_JOBS_PER_SHIFT;
  if (limitRaw !== null) {
    const trimmed = limitRaw.trim();
    if (!isPositiveInt(trimmed)) {
      errors.push(`limit: '${limitRaw}' is not a positive integer`);
    } else {
      const n = Number(trimmed);
      if (n <= 0) {
        errors.push(`limit: must be > 0`);
      } else if (n > MAX_JOBS_PER_SHIFT) {
        errors.push(`limit: must be ≤ ${MAX_JOBS_PER_SHIFT} (got ${n})`);
      } else {
        limit = n;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    filters: {
      phaseFilter, riskFilter, verdictFilter, titleQuery, shortNums, limit,
      filtersApplied: {
        phase: Array.from(phaseFilter).sort(),
        risk: Array.from(riskFilter).sort(),
        verdict: verdictFilter || null,
        q: titleQuery || null,
        short_num: Array.from(shortNums).sort((a, b) => a - b),
        limit,
      },
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
