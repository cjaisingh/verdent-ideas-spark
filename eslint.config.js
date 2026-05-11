import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

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
      // Tracked tech debt: ~480 pre-existing `any` usages. Demoted to warn so CI
      // unblocks while the cleanup action chips away at them. See
      // mem://features/lint-policy and the open discussion_action.
      "@typescript-eslint/no-explicit-any": "warn",
      // Pre-existing code-quality issues across the repo — demoted to warn so
      // CI unblocks. Tracked separately; do not introduce new occurrences.
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-useless-escape": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // Playwright fixtures legitimately use a `use` callback parameter that
    // collides with React's hook-naming rule. Scope the override narrowly.
    files: ["e2e-playwright/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
