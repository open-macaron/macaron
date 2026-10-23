import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals }) => {
  // hooks.server.ts already sent visitors without a session to sign in: this narrows the type.
  if (locals.user === null) redirect(303, resolve("/sign-in"));
  return { user: locals.user };
};
