import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Types and Zod validators for the controller's API, generated from the OpenAPI document the
 * controller emits (packages/contracts/openapi/controller.json). The transport is a few lines
 * of fetch in src/controller-api.ts that validate every response with these schemas.
 */
export default defineConfig({
  input: "../contracts/openapi/controller.json",
  output: { path: "./src/generated/controller", importFileExtension: ".ts" },
  plugins: ["@hey-api/typescript", { name: "zod", requests: true, responses: true }],
});
