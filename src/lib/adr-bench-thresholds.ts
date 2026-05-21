// Mirror of docs/adr/benchmarks.md decision/revisit thresholds.
// Pure function — no DB. Page calls this with a row's metrics to render status.
// Keep in sync with benchmarks.md in the same PR.

export type TriggerStatus = "green" | "watch" | "revisit";

export type BenchEvaluation = {
  status: TriggerStatus;
  tripped: string[];
  watch: string[];
};

type Metrics = Record<string, number>;

function n(m: Metrics, k: string): number {
  const v = m[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function evalAdr0003(m: Metrics): BenchEvaluation {
  const tripped: string[] = [];
  const watch: string[] = [];
  if (n(m, "rls_check_p95_ms") >= 3) tripped.push("rls_check_p95_ms ≥ 3");
  if (n(m, "subtree_move_p95_ms") >= 500) tripped.push("subtree_move_p95_ms ≥ 500");
  // ancestry_ids[] vs parent_id 3× ratio not derivable from a single row.
  if (n(m, "rls_check_p95_ms") >= 2) watch.push("rls_check_p95_ms near limit");
  return { status: tripped.length ? "revisit" : watch.length ? "watch" : "green", tripped, watch };
}

function evalAdr0004(m: Metrics): BenchEvaluation {
  const tripped: string[] = [];
  const watch: string[] = [];
  if (n(m, "affected_facts_p95") > 1000) tripped.push("affected_facts_p95 > 1000 (block both)");
  if (n(m, "stale_badge_dwell_p95_days") > 14) tripped.push("stale_badge_dwell_p95_days > 14");
  if (n(m, "affected_facts_p95") > 200) watch.push("affected_facts_p95 above hybrid threshold");
  return { status: tripped.length ? "revisit" : watch.length ? "watch" : "green", tripped, watch };
}

function evalAdr0005(m: Metrics): BenchEvaluation {
  const tripped: string[] = [];
  const watch: string[] = [];
  if (n(m, "false_positive_rate") > 0.1) tripped.push("false_positive_rate > 10%");
  if (n(m, "heuristic_coverage_pct") < 40) tripped.push("heuristic_coverage_pct < 40% (LLM-only)");
  if (n(m, "heuristic_coverage_pct") < 70) watch.push("heuristic_coverage_pct below hybrid floor");
  return { status: tripped.length ? "revisit" : watch.length ? "watch" : "green", tripped, watch };
}

function evalAdr0006(m: Metrics): BenchEvaluation {
  // ai_usage_log stores cost_usd; the ADR's intent is €50/mo but the metric is USD.
  const tripped: string[] = [];
  const watch: string[] = [];
  if (n(m, "embedding_spend_usd_30d") > 50) tripped.push("embedding_spend_usd_30d > $50");
  if (n(m, "vector_row_count_max") > 1_000_000) tripped.push("vector_row_count_max > 1M");
  if (n(m, "embedding_spend_usd_30d") > 25) watch.push("spend > $25 (half of revisit threshold)");
  if (n(m, "vector_row_count_max") > 500_000) watch.push("rows > 500k (half of revisit threshold)");
  return { status: tripped.length ? "revisit" : watch.length ? "watch" : "green", tripped, watch };
}

export function evaluateBench(adr: string, metrics: Metrics): BenchEvaluation {
  switch (adr.toLowerCase()) {
    case "adr-0003": return evalAdr0003(metrics);
    case "adr-0004": return evalAdr0004(metrics);
    case "adr-0005": return evalAdr0005(metrics);
    case "adr-0006": return evalAdr0006(metrics);
    default: return { status: "green", tripped: [], watch: [] };
  }
}

export const ADR_DECISION_QUESTIONS: Record<string, string> = {
  "adr-0003": "Which tenant-node ancestry storage minimises p95 RLS read cost?",
  "adr-0004": "Soft, hard, or hybrid alias revocation cascade?",
  "adr-0005": "Heuristic, LLM, or hybrid bulk conflict pattern detection?",
  "adr-0006": "Are any of the four embedding revisit triggers firing?",
};
