import { describe, it, expect } from "vitest";
import { rollupActionValue } from "./okrValue";

describe("rollupActionValue", () => {
  it("prefers KR value when action is linked to a KR", () => {
    const result = rollupActionValue(
      {
        okr_node_id: "kr-1",
        projected_value_usd: 999,
        realized_value_usd: 50,
      },
      { projected_value_usd: 10000, realized_value_usd: 2500 },
    );
    expect(result).toEqual({
      projected_value_usd: 10000,
      realized_value_usd: 2500,
      source: "kr",
    });
  });

  it("falls back to action override when no KR is linked", () => {
    const result = rollupActionValue(
      {
        okr_node_id: null,
        projected_value_usd: 750,
        realized_value_usd: null,
      },
      null,
    );
    expect(result).toEqual({
      projected_value_usd: 750,
      realized_value_usd: null,
      source: "action",
    });
  });

  it("returns nulls with source=none when neither side has a value", () => {
    const result = rollupActionValue(
      {
        okr_node_id: null,
        projected_value_usd: null,
        realized_value_usd: null,
      },
      null,
    );
    expect(result).toEqual({
      projected_value_usd: null,
      realized_value_usd: null,
      source: "none",
    });
  });

  it("uses KR even when action carries a stale override", () => {
    const result = rollupActionValue(
      {
        okr_node_id: "kr-2",
        projected_value_usd: 1,
        realized_value_usd: 1,
      },
      { projected_value_usd: null, realized_value_usd: null },
    );
    expect(result.source).toBe("kr");
    expect(result.projected_value_usd).toBeNull();
  });
});
