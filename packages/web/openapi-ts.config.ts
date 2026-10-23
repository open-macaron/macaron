import { defineConfig } from "@hey-api/openapi-ts";

/**
 * The controller's client for the web app, generated from the OpenAPI document the controller
 * emits (packages/contracts/openapi/controller.json): the routes the web app calls, every response
 * validated with Zod. Under a `server` directory: SvelteKit never lets it reach the browser.
 */
export default defineConfig({
  input: "../contracts/openapi/controller.json",
  output: { path: "./src/lib/server/controller/generated", importFileExtension: ".ts" },
  // The runner's route stays out: the web app has no business with it.
  parser: { filters: { operations: { exclude: ["POST /v1/bootstrap"] } } },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", { name: "zod", requests: true, responses: true }, { name: "@hey-api/sdk", validator: true }],
});
