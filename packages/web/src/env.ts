import { building } from "$app/env";
import { defineEnvVars } from "@sveltejs/kit/env";
import { z } from "zod";

/** The app's only configuration, validated at start: a bad value fails the boot, not a request. */
export const variables = defineEnvVars({
  CONTROLLER_URL: {
    description: "The controller's internal URL (the cluster Service), never a public one",
    schema: building ? z.url().optional() : z.url(),
  },
});
