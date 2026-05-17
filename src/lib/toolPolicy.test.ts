import { describe, it, expect } from "vitest";
import { recommend, type ToolPolicyRule } from "./toolPolicy";

const rule = (over: Partial<ToolPolicyRule>): ToolPolicyRule => ({
  id: crypto.randomUUID(),
  name: "r",
  precedence: 100,
  task_types: [],
  phase_ids: null,
  min_credits_remaining_pct: null,
  max_credits_remaining_pct: null,
  min_burn_rate_per_day: null,
  recommended_tool: "lovable",
  reasoning: "",
  enabled: true,
  ...over,
});

const noSignals = { mtd_credits: 0, budget: null, remaining_pct: null, burn_7d_per_day: null, projected_month_end: null };

describe("recommend", () => {
  it("falls back to lovable when no rules match", () => {
    const r = recommend([], { task_type: "new_feature", signals: noSignals });
    expect(r.tool).toBe("lovable");
    expect(r.rule).toBeNull();
  });

  it("respects precedence order", () => {
    const rules = [
      rule({ precedence: 10, recommended_tool: "claude", reasoning: "first" }),
      rule({ precedence: 20, recommended_tool: "lovable", reasoning: "second" }),
    ];
    expect(recommend(rules, { task_type: "refactor", signals: noSignals }).tool).toBe("claude");
  });

  it("filters by task_type", () => {
    const rules = [
      rule({ precedence: 10, task_types: ["ui_tweak"], recommended_tool: "lovable" }),
      rule({ precedence: 20, task_types: ["refactor"], recommended_tool: "claude" }),
    ];
    expect(recommend(rules, { task_type: "refactor", signals: noSignals }).tool).toBe("claude");
  });

  it("max_credits_remaining_pct gates credit-conservation rule", () => {
    const rules = [
      rule({ precedence: 10, max_credits_remaining_pct: 15, recommended_tool: "claude" }),
      rule({ precedence: 999, recommended_tool: "lovable" }),
    ];
    expect(recommend(rules, { task_type: "new_feature", signals: { ...noSignals, remaining_pct: 50 } }).tool).toBe("lovable");
    expect(recommend(rules, { task_type: "new_feature", signals: { ...noSignals, remaining_pct: 10 } }).tool).toBe("claude");
  });

  it("min_burn_rate_per_day requires burn signal", () => {
    const rules = [rule({ precedence: 10, min_burn_rate_per_day: 5, recommended_tool: "claude" })];
    expect(recommend(rules, { task_type: "refactor", signals: { ...noSignals, burn_7d_per_day: 2 } }).tool).toBe("lovable");
    expect(recommend(rules, { task_type: "refactor", signals: { ...noSignals, burn_7d_per_day: 10 } }).tool).toBe("claude");
  });

  it("skips disabled rules", () => {
    const rules = [
      rule({ precedence: 10, recommended_tool: "claude", enabled: false }),
      rule({ precedence: 20, recommended_tool: "cursor" }),
    ];
    expect(recommend(rules, { task_type: "new_feature", signals: noSignals }).tool).toBe("cursor");
  });
});
