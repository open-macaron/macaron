import { query } from "$app/server";
import { ModelStatsRange } from "#lib/admin/forms.js";
import { requireAdmin } from "#lib/server/admin/access.js";
import { controller, unwrap } from "#lib/server/controller/index.js";
import { getModelStats as fetchModelStats } from "#lib/server/controller/generated/sdk.gen.js";

/** Each model's average cost and tokens per settled run over the range, per day or week of it. */
export const getModelStats = query(ModelStatsRange, async (range) => {
  requireAdmin();
  return unwrap(await fetchModelStats({ client: controller(), query: { range } }));
});
