// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/dist-cli/**", "**/dist-npm/**", "**/dist-scripts/**", "packages/agent-cli/src/generated/**", "**/coverage/**", "**/schemas/**", "**/drizzle/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        // Nest reads constructor parameter types at runtime: decorated signatures must keep value imports.
        { prefer: "type-imports", fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read configuration through the validated config module, never process.env directly.",
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/test/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
