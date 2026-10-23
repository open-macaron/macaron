import { query } from "$app/server";
import { z } from "zod";
import { requireUser } from "#lib/server/admin/access.js";
import { controller, unwrap } from "#lib/server/controller/index.js";
import { getMe as me, getMyUsage } from "#lib/server/controller/generated/sdk.gen.js";

/** The signed-in user's profile and capabilities. */
export const getMe = query(async () => {
  requireUser();
  return unwrap(await me({ client: controller() }));
});

/** A page of the signed-in user's runs, newest first; `before` is the previous page's cursor. */
export const getUsage = query(z.object({ before: z.string().max(200).optional(), limit: z.int().min(1).max(100).default(25) }), async ({ before, limit }) => {
  requireUser();
  return unwrap(await getMyUsage({ client: controller(), query: before === undefined ? { limit } : { before, limit } }));
});
