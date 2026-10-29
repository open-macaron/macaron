import { query } from "$app/server";
import { z } from "zod";
import { ActivityFilters } from "#lib/admin/forms.js";
import { requireAdmin } from "#lib/server/admin/access.js";
import { controller, unwrap } from "#lib/server/controller/index.js";
import { listRefusals, listRuns } from "#lib/server/controller/generated/sdk.gen.js";

const Page = z.object({ before: z.string().max(200).optional(), limit: z.int().min(1).max(100).default(25) });

/** A page of every user's runs, newest first, under the page's filters. */
export const getRuns = query(ActivityFilters.extend(Page.shape), async (input) => {
  requireAdmin();
  return unwrap(await listRuns({ client: controller(), query: input }));
});

/** A page of the requests the bot refused, newest first; status and mode don't apply to them. */
export const getRefusals = query(ActivityFilters.pick({ user: true, repo: true }).extend(Page.shape), async (input) => {
  requireAdmin();
  return unwrap(await listRefusals({ client: controller(), query: input }));
});
