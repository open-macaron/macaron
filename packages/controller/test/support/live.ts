import { type AppEnv, Env } from "../../src/config/env.ts";

/**
 * The real environment for live tests (`pnpm test:live`, with ~/.config/macaron/dev.env loaded),
 * or undefined when it isn't there — live tests then skip instead of failing.
 */
export function liveEnv(): AppEnv | undefined {
  // eslint-disable-next-line no-restricted-syntax -- tests read the developer's real environment on purpose
  const parsed = Env.safeParse(process.env);
  return parsed.success ? parsed.data : undefined;
}
