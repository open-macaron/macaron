import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Types and Zod validators for the part of Bifrost's admin API that BifrostKeys uses (virtual keys, endpoint providers and their keys, pricing overrides), generated
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
          "GET /api/providers",
          "POST /api/providers",
          "GET /api/providers/{provider}",
          "GET /api/providers/{provider}/keys",
          "POST /api/providers/{provider}/keys",
          "DELETE /api/providers/{provider}/keys/{key_id}",
          "GET /api/governance/pricing-overrides",
          "POST /api/governance/pricing-overrides",
          "PUT /api/governance/pricing-overrides/{id}",
        ],
      },
    },
  },
  plugins: ["@hey-api/typescript", { name: "zod", requests: true, responses: true }],
});
