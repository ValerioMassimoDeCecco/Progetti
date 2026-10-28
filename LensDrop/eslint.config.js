import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
  })),
  {
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
    },
  },
  {
    files: ["public/sw.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  },
);
