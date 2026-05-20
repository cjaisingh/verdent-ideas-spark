/**
 * Shared loader for the ratchet config. Used by:
 *   - scripts/lint-ratchet.ts        (multi-rule ratchet check)
 *   - scripts/lint-ratchet-freeze.ts (multi-rule baseline freeze)
 *   - eslint.config.js               (per-rule promotion to error)
 */
import { readFileSync, existsSync } from "node:fs";

export type RatchetRule = {
  rule: string;
  baseline: string;
  /** Severity for files that *are* in the baseline. Defaults to "warn". */
  baselineSeverity?: "warn" | "error" | "off";
  /** Severity for files *not* in the baseline. Defaults to "error". */
  promoteOutsideBaselineTo?: "warn" | "error" | "off";
};

export type RatchetConfig = { rules: RatchetRule[] };

export type Baseline = {
  generatedAt: string;
  rule: string;
  total: number;
  files: Record<string, number>;
};

export const RATCHET_CONFIG_PATH = ".lint-baselines/ratchet.config.json";

export function loadConfig(): RatchetConfig {
  if (!existsSync(RATCHET_CONFIG_PATH)) {
    // Back-compat: synthesise the legacy single-rule setup if no config file
    // exists. Lets the scripts keep working in branches that predate this file.
    return {
      rules: [
        {
          rule: "@typescript-eslint/no-explicit-any",
          baseline: ".lint-baselines/no-explicit-any.json",
          baselineSeverity: "warn",
          promoteOutsideBaselineTo: "error",
        },
      ],
    };
  }
  const raw = JSON.parse(readFileSync(RATCHET_CONFIG_PATH, "utf8")) as RatchetConfig;
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new Error(`${RATCHET_CONFIG_PATH}: "rules" must be a non-empty array`);
  }
  return raw;
}

export function loadBaselineFor(rule: RatchetRule): Baseline | null {
  if (!existsSync(rule.baseline)) return null;
  return JSON.parse(readFileSync(rule.baseline, "utf8")) as Baseline;
}
