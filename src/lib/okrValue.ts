// OKR value rollup helper.
//
// Rule: the Key Result is the canonical home of value. An action's own
// projected/realized value is only used when the action is NOT linked to a KR
// (i.e. `okr_node_id IS NULL`). This prevents double-counting when many
// actions roll up under one KR.
//
// All amounts are USD (numeric). Multi-currency is out of scope until a
// non-USD KR appears in the wild.

export interface OkrValueSource {
  projected_value_usd: number | null;
  realized_value_usd: number | null;
}

export interface ActionLike extends OkrValueSource {
  okr_node_id?: string | null;
}

export interface RolledUpValue {
  projected_value_usd: number | null;
  realized_value_usd: number | null;
  source: "kr" | "action" | "none";
}

/**
 * Pick the authoritative value for an action.
 * - KR wins when the action is linked to a KR.
 * - Action override is only consulted when no KR is linked.
 * - Returns nulls + source="none" when neither side has a value.
 */
export function rollupActionValue(
  action: ActionLike,
  kr: OkrValueSource | null,
): RolledUpValue {
  if (action.okr_node_id && kr) {
    return {
      projected_value_usd: kr.projected_value_usd,
      realized_value_usd: kr.realized_value_usd,
      source: "kr",
    };
  }
  if (
    action.projected_value_usd !== null ||
    action.realized_value_usd !== null
  ) {
    return {
      projected_value_usd: action.projected_value_usd,
      realized_value_usd: action.realized_value_usd,
      source: "action",
    };
  }
  return {
    projected_value_usd: null,
    realized_value_usd: null,
    source: "none",
  };
}
