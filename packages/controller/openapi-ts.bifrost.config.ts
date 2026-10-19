import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Types and Zod validators for the part of Bifrost's admin API that BifrostKeys uses, generated
 * from Bifrost's OpenAPI document at the commit of the pinned image (transports/v2.3.0). Bump
 * both together, then run `pnpm --filter @open-macaron/controller gen:bifrost`.
 */
export default defineConfig({
  input: "https://raw.githubusercontent.com/maximhq/bifrost/9237ec06672406e437b3cb33fc793ffd0403b3ae/docs/openapi/openapi.json",
  output: { path: "./src/generated/bifrost", importFileExtension: ".ts" },
  parser: {
    filters: {
      operations: {
        include: [
          "GET /api/governance/virtual-keys",
          "POST /api/governance/virtual-keys",
          "GET /api/governance/virtual-keys/{vk_id}",
          "PUT /api/governance/virtual-keys/{vk_id}",
          "DELETE /api/governance/virtual-keys/{vk_id}",
          "GET /api/models/details",
        ],
      },
    },
  },
  plugins: ["@hey-api/typescript", { name: "zod", requests: true, responses: true }],
});
