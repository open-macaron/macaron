import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Types and Zod validators for the controller's API, generated from the OpenAPI document the
 * controller emits (packages/contracts/openapi/controller.json). The transport is a few lines
 * of fetch in src/controller-api.ts that validate every response with these schemas.
 */
export default defineConfig({
  input: "../contracts/openapi/controller.json",
  // The runner's only call: the web app's routes (/v1/me, /v1/admin) stay out of its client.
  parser: { filters: { operations: { include: ["POST /v1/bootstrap"] } } },
  output: { path: "./src/generated/controller", importFileExtension: ".ts" },
  plugins: ["@hey-api/typescript", { name: "zod", requests: true, responses: true }],
});
