import { z } from "zod";
import { type AppEnv, type BifrostEnv, Env } from "../../src/config/env.ts";

/**
 * The real environment for live tests (`pnpm test:live`, with ~/.config/macaron/dev.env loaded),
 * or undefined when it isn't there — live tests then skip instead of failing.
 */
export function liveEnv(): AppEnv | undefined {
  // eslint-disable-next-line no-restricted-syntax -- tests read the developer's real environment on purpose
  const parsed = Env.safeParse(process.env);
  return parsed.success ? parsed.data : undefined;
}

const LiveBifrost = z.object({
  BIFROST_ADMIN_URL: z.url(),
  BIFROST_ADMIN_PASSWORD: z.string().min(20),
  BIFROST_ADMIN_USERNAME: z.string().min(1).default("macaron"),
});

/**
 * A local Bifrost (deploy/bifrost/dev.sh) for live tests, or undefined when BIFROST_ADMIN_URL isn't
 * in the developer's environment. Runners' requests go straight to Bifrost's /anthropic route.
 */
export function liveBifrost(): BifrostEnv | undefined {
  // eslint-disable-next-line no-restricted-syntax -- tests read the developer's real environment on purpose
  const parsed = LiveBifrost.safeParse(process.env);
  if (!parsed.success) return undefined;
  const { BIFROST_ADMIN_URL: adminUrl, BIFROST_ADMIN_PASSWORD: password, BIFROST_ADMIN_USERNAME: username } = parsed.data;
  return { adminUrl, publicUrl: new URL("/anthropic", adminUrl).toString(), username, password, provider: "anthropic", requestsPerMinute: 60 };
}
