import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // SWC emits decorator metadata, which Nest's dependency injection reads at runtime.
  plugins: [swc.vite({ jsc: { target: "es2023" }, module: { type: "es6" } })],
  resolve: { conditions: ["@open-macaron/source"] },
  test: {
    projects: [
      { extends: true, test: { name: "contracts", include: ["packages/contracts/test/**/*.test.ts"] } },
      { extends: true, test: { name: "agent-cli", include: ["packages/agent-cli/test/**/*.test.ts"] } },
      { extends: true, test: { name: "controller", include: ["apps/controller/test/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "controller-integration",
          include: ["apps/controller/test/integration/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**", "packages/*/src/**"],
      exclude: ["**/generated/**"],
    },
  },
});
