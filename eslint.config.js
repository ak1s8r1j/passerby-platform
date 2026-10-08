import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/generated/**",
      "**/.pg-data/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    files: [
      "apps/api/**/*.ts",
      "packages/**/*.ts",
      "*.config.{js,ts}",
      "apps/*/*.config.{js,ts}",
      "scripts/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Scripts and tests may print to the terminal.
    files: ["apps/api/scripts/**", "scripts/**", "**/*.test.{ts,tsx}", "apps/*/vitest.*.ts"],
    rules: { "no-console": "off" },
  },
);
