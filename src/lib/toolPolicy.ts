// Deterministic tool-selection recommender.
// First matching enabled rule (lowest precedence) wins.

export type Tool = "lovable" | "claude" | "cursor" | "codex" | "manual";

export type TaskType =
  | "new_feature"
  | "refactor"
  | "bug_fix"
  | "ui_tweak"
  | "pure_logic"
  | "tests"
  | "docs"
  | "migration"
  | "edge_fn";

export const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: "new_feature", label: "New feature" },
  { value: "refactor", label: "Refactor" },
  { value: "bug_fix", label: "Bug fix" },
  { value: "ui_tweak", label: "UI tweak" },
  { value: "pure_logic", label: "Pure logic" },
  { value: "tests", label: "Tests" },
  { value: "docs", label: "Docs" },
  { value: "migration", label: "DB migration" },
  { value: "edge_fn", label: "Edge function" },
];

export const TOOL_LABELS: Record<Tool, string> = {
  lovable: "Lovable",
  claude: "Claude Max",
  cursor: "Cursor",
  codex: "Codex",
  manual: "Do it manually",
};

export interface ToolPolicyRule {
  id: string;
  name: string;
  precedence: number;
  task_types: string[];
  phase_ids: string[] | null;
  min_credits_remaining_pct: number | null;
  max_credits_remaining_pct: number | null;
  min_burn_rate_per_day: number | null;
  recommended_tool: Tool;
  reasoning: string;
  enabled: boolean;
}

export interface PolicySignals {
  mtd_credits: number | null;
  budget: number | null;
  remaining_pct: number | null;
  burn_7d_per_day: number | null;
  projected_month_end: number | null;
}

export interface RecommendationInput {
  task_type: TaskType;
  phase_id?: string | null;
  signals: PolicySignals;
}

export interface RecommendationResult {
  tool: Tool;
  rule: ToolPolicyRule | null;
  reasoning: string;
  considered: { rule: ToolPolicyRule; matched: boolean; failed_on?: string }[];
}

export function recommend(
  rules: ToolPolicyRule[],
  input: RecommendationInput,
): RecommendationResult {
  const sorted = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.precedence - b.precedence);

  const considered: RecommendationResult["considered"] = [];
  const { task_type, phase_id, signals } = input;
  const remaining = signals.remaining_pct;
  const burn = signals.burn_7d_per_day;

  for (const r of sorted) {
    let failed: string | undefined;

    if (r.task_types.length > 0 && !r.task_types.includes(task_type)) {
      failed = `task type ${task_type} not in [${r.task_types.join(",")}]`;
    } else if (r.phase_ids && r.phase_ids.length > 0 && (!phase_id || !r.phase_ids.includes(phase_id))) {
      failed = "phase not in scope";
    } else if (r.min_credits_remaining_pct != null && (remaining == null || remaining < r.min_credits_remaining_pct)) {
      failed = `credits remaining (${remaining ?? "?"}%) below min ${r.min_credits_remaining_pct}%`;
    } else if (r.max_credits_remaining_pct != null && (remaining == null || remaining > r.max_credits_remaining_pct)) {
      failed = `credits remaining (${remaining ?? "?"}%) above max ${r.max_credits_remaining_pct}%`;
    } else if (r.min_burn_rate_per_day != null && (burn == null || burn < r.min_burn_rate_per_day)) {
      failed = `7d burn (${burn ?? "?"}/day) below min ${r.min_burn_rate_per_day}/day`;
    }

    considered.push({ rule: r, matched: !failed, failed_on: failed });
    if (!failed) {
      return { tool: r.recommended_tool, rule: r, reasoning: r.reasoning, considered };
    }
  }

  return {
    tool: "lovable",
    rule: null,
    reasoning: "No enabled rule matched. Defaulting to Lovable.",
    considered,
  };
}
