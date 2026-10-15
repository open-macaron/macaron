import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { Logger } from "@nestjs/common";

const MacaronOctokit = Octokit.plugin(throttling, retry);

/** An Octokit with throttling and retries, pinned to one API version. */
export type GitHub = InstanceType<typeof MacaronOctokit>;

/**
 * Capability-scoped clients (ENGINEERING.md §4). Each token is its own injection token, and
 * lint rules restrict which modules may inject which.
 */
export const GH_INTERACT = Symbol("GH_INTERACT"); // comments, reactions, PRs, notifications; reads public repos (artifacts)
export const GH_PUSH = Symbol("GH_PUSH"); // git data writes on the bot's forks only
export const GH_ORG = Symbol("GH_ORG"); // open-macaron/runner only: start and cancel workflow runs

/** Endpoints whose retries we control ourselves (X-Poll-Interval must win over any auto-retry). */
const SELF_PACED = /\/notifications(\/|$|\?)/;

export function createGitHub(name: string, token: string, apiVersion: string): GitHub {
  const logger = new Logger(`GitHub:${name}`);
  return new MacaronOctokit({
    auth: token,
    userAgent: "open-macaron/controller",
    request: { headers: { "x-github-api-version": apiVersion } },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        logger.warn(message);
      },
      error: (message: string) => {
        logger.error(message);
      },
    },
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        logger.warn(`rate limited on ${options.method} ${options.url}, retry after ${String(retryAfter)}s`);
        return !SELF_PACED.test(options.url) && retryCount < 1 && retryAfter <= 60;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        logger.warn(`secondary rate limit on ${options.method} ${options.url}, retry after ${String(retryAfter)}s`);
        return !SELF_PACED.test(options.url) && retryCount < 1 && retryAfter <= 120;
      },
    },
  });
}
