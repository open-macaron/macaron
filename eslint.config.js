// @ts-check
import eslint from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-cli/**",
      "**/dist-npm/**",
      "**/dist-scripts/**",
      "packages/agent-cli/src/generated/**",
      "packages/controller/src/generated/**",
      "**/coverage/**",
      "**/schemas/**",
      "**/drizzle/**",
      // SvelteKit's generated files and build output.
      "**/.svelte-kit/**",
      "packages/web/build/**",
      // Vendored by the shadcn-svelte CLI: updated with the CLI, never edited by hand.
      "packages/web/src/lib/components/ui/**",
      "packages/web/src/lib/hooks/is-mobile.svelte.ts",
      "packages/web/src/lib/utils.ts",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
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
  // Svelte: the plugin's recommended set, then stricter rules it leaves opt-in (it ships no "strict" preset).
  svelte.configs.recommended,
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      "svelte/block-lang": ["error", { script: "ts", style: null }],
      "svelte/button-has-type": "error",
      "svelte/no-target-blank": ["error", { allowReferrer: false, enforceDynamicLinks: "always" }],
      "svelte/require-each-key": "error",
      "svelte/no-inline-styles": "error",
      "svelte/consistent-selector-style": "error",
      "svelte/prefer-const": "error",
      "svelte/no-ignored-unsubscribe": "error",
      "svelte/require-stores-init": "error",
      "svelte/no-store-async": "error",
      "svelte/derived-has-same-inputs-outputs": "error",
      "svelte/valid-style-parse": "error",
      "svelte/no-useless-mustaches": "error",
      "svelte/no-spaces-around-equal-signs-in-attribute": "error",
      "svelte/shorthand-attribute": "error",
      "svelte/shorthand-directive": "error",
      "svelte/require-event-prefix": "error",
      "svelte/no-add-event-listener": "error",
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
