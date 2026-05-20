import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { readFileSync, existsSync } from "node:fs";

// Load ratchet config (see scripts/lint-ratchet-config.ts). Each rule listed
// here gets two passes: the baseline files keep `baselineSeverity` (typically
// "warn"), and every file *outside* the baseline is promoted to
// `promoteOutsideBaselineTo` (typically "error"). Shrink the baseline and the
// promoted set automatically grows.
const RATCHET_CONFIG_PATH = ".lint-baselines/ratchet.config.json";
const ratchetRules = (() => {
  if (existsSync(RATCHET_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(RATCHET_CONFIG_PATH, "utf8"));
      if (Array.isArray(raw.rules)) return raw.rules;
    } catch {
      // fall through to legacy
    }
  }
  // Legacy single-rule fallback for branches without the config file.
  return [
    {
      rule: "@typescript-eslint/no-explicit-any",
      baseline: ".lint-baselines/no-explicit-any.json",
      baselineSeverity: "warn",
      promoteOutsideBaselineTo: "error",
    },
  ];
})();

const ratchetBlocks = [];
const baselineDefaults = {};
for (const r of ratchetRules) {
  const baselineFiles = existsSync(r.baseline)
    ? Object.keys(JSON.parse(readFileSync(r.baseline, "utf8")).files ?? {})
    : [];
  baselineDefaults[r.rule] = r.baselineSeverity ?? "warn";
  const promoted = r.promoteOutsideBaselineTo ?? "error";
  // Outside-baseline files → promoted severity. If the baseline is empty
  // (rule fully clean), every file is promoted.
  ratchetBlocks.push({
    files: ["**/*.{ts,tsx}"],
    ...(baselineFiles.length > 0 ? { ignores: baselineFiles } : {}),
    rules: { [r.rule]: promoted },
  });
}

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Ratchet defaults: severity for files *in* the baseline. The promotion
      // blocks below tighten files outside the baseline to error. See
      // docs/lint-policy.md and .lint-baselines/ratchet.config.json.
      ...baselineDefaults,
      // Pre-existing code-quality issues — demoted to warn so CI unblocks.
      // Add to the ratchet config when you want to start tightening one.
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-useless-escape": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
    },
  },
  ...ratchetBlocks,
  {
    // Playwright fixtures legitimately use a `use` callback parameter that
    // collides with React's hook-naming rule. Scope the override narrowly.
    files: ["e2e-playwright/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
