import { z } from "zod";
import { RepoSlug } from "@open-macaron/contracts";
import { LlmBackend } from "../budget/run-keys.ts";

const Secret = z.string().min(20, "looks too short to be a real credential");

/** Every environment variable the controller reads, as given. */
const RawEnv = z.object({
  NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  /** Public base URL behind Caddy; also the OIDC audience runners must request. */
  PUBLIC_URL: z.url({ protocol: /^https$/ }),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "expected a postgres:// URL"),
  /** Directory holding global.yaml and projects/ (delivered by deploy.sh). */
  CONFIG_DIR: z.string().min(1).default("/opt/macaron/config"),
  /** Kill switch: when false, nothing is ingested and every open key is revoked. */
  MACARON_ENABLED: z.stringbool().default(true),
  /**
   * Operator allowlist of GitHub user ids (comma-separated), checked on top of the config's
   * trust lists. Ids, not logins: a login can be renamed and re-registered. Unset = no restriction.
   */
  MACARON_ALLOWED_USER_IDS: z
    .string()
    .regex(/^\d+(,\d+)*$/, "expected comma-separated numeric GitHub user ids")
    .transform((ids) => new Set(ids.split(",").map(Number)))
    .optional(),

  GITHUB_BOT_LOGIN: z.string().min(1).default("macaron-bot"),
  GITHUB_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-03-10"),
  GH_INTERACT: Secret,
  GH_PUSH: Secret,
  GH_ORG: Secret,

  RUNNER_REPO: RepoSlug.default(RepoSlug.parse("open-macaron/runner")),
  /** Immutable ids pinned in the OIDC check (DESIGN.md "Everything is public"). */
  RUNNER_REPO_ID: z.coerce.number().int().positive(),
  RUNNER_OWNER_ID: z.coerce.number().int().positive(),
  RUNNER_WORKFLOW: z.string().regex(/^[a-z0-9-]+\.ya?ml$/).default("run.yml"),
  /** open-macaron/knowledge's read API on GitHub Pages (DESIGN.md §6.5). */
  KNOWLEDGE_URL: z.url({ protocol: /^https$/ }).default("https://open-macaron.github.io/knowledge/v1"),

  /** Where new runs get their LLM key. Every backend whose variables are set stays usable for runs minted on it before a switch. */
  LLM_BACKEND: LlmBackend.default("openrouter"),

  /** OpenRouter backend: configured when OPENROUTER_PROVISIONING_KEY is set. */
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  /** Workspace (slug) holding every key we create, so its dashboard shows the bot's total spend. */
  OPENROUTER_WORKSPACE: z.string().regex(/^[a-z0-9-]+$/).default("macaron"),
  OPENROUTER_PROVISIONING_KEY: Secret.optional(),
  OPENROUTER_ROUTER_KEY: Secret.optional(),

  /** Bifrost backend (virtual keys over the company's ENMAAS key): configured when BIFROST_ADMIN_URL is set. */
  BIFROST_ADMIN_URL: z.url().optional(),
  /** What runners use as ANTHROPIC_BASE_URL: Caddy's inference-only route to Bifrost. */
  BIFROST_PUBLIC_URL: z.url({ protocol: /^https$/ }).optional(),
  BIFROST_ADMIN_USERNAME: z.string().min(1).default("macaron"),
  BIFROST_ADMIN_PASSWORD: Secret.optional(),
  /** Bifrost's provider holding the upstream key. */
  BIFROST_PROVIDER: z.string().regex(/^[a-z0-9_-]+$/).default("anthropic"),
  /**
   * Requests per minute a run's key may start. Bifrost checks a budget before a request and charges
   * it after, so this bounds how many requests can be in flight past the limit.
   */
  BIFROST_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(60),

  WEBHOOK_HMAC: z.string().min(32, "use at least 32 random characters"),
});

export interface OpenRouterEnv {
  readonly baseUrl: string;
  readonly workspace: string;
  readonly provisioningKey: string;
  readonly routerKey: string;
}

export interface BifrostEnv {
  readonly adminUrl: string;
  readonly publicUrl: string;
  readonly username: string;
  readonly password: string;
  readonly provider: string;
  readonly requestsPerMinute: number;
}

/** Every environment variable the controller reads. Parsed once at boot; the process exits if invalid. */
export const Env = RawEnv.transform((raw, ctx) => {
  const missing = (variables: Readonly<Record<string, unknown>>, why: string) => {
    for (const [name, value] of Object.entries(variables)) {
      if (value === undefined) ctx.addIssue({ code: "custom", path: [name], message: `required ${why}` });
    }
  };
  let openRouter: OpenRouterEnv | undefined;
  if (raw.OPENROUTER_PROVISIONING_KEY !== undefined || raw.LLM_BACKEND === "openrouter") {
    missing(
      { OPENROUTER_PROVISIONING_KEY: raw.OPENROUTER_PROVISIONING_KEY, OPENROUTER_ROUTER_KEY: raw.OPENROUTER_ROUTER_KEY },
      "for the OpenRouter backend",
    );
    if (raw.OPENROUTER_PROVISIONING_KEY !== undefined && raw.OPENROUTER_ROUTER_KEY !== undefined) {
      openRouter = {
        baseUrl: raw.OPENROUTER_BASE_URL,
        workspace: raw.OPENROUTER_WORKSPACE,
        provisioningKey: raw.OPENROUTER_PROVISIONING_KEY,
        routerKey: raw.OPENROUTER_ROUTER_KEY,
      };
    }
  }
  let bifrost: BifrostEnv | undefined;
  if (raw.BIFROST_ADMIN_URL !== undefined || raw.LLM_BACKEND === "bifrost") {
    missing(
      { BIFROST_ADMIN_URL: raw.BIFROST_ADMIN_URL, BIFROST_PUBLIC_URL: raw.BIFROST_PUBLIC_URL, BIFROST_ADMIN_PASSWORD: raw.BIFROST_ADMIN_PASSWORD },
      "for the Bifrost backend",
    );
    if (raw.BIFROST_ADMIN_URL !== undefined && raw.BIFROST_PUBLIC_URL !== undefined && raw.BIFROST_ADMIN_PASSWORD !== undefined) {
      bifrost = {
        adminUrl: raw.BIFROST_ADMIN_URL,
        publicUrl: raw.BIFROST_PUBLIC_URL,
        username: raw.BIFROST_ADMIN_USERNAME,
        password: raw.BIFROST_ADMIN_PASSWORD,
        provider: raw.BIFROST_PROVIDER,
        requestsPerMinute: raw.BIFROST_REQUESTS_PER_MINUTE,
      };
    }
  }
  return { ...raw, openRouter, bifrost };
});
export type AppEnv = z.output<typeof Env>;

export const APP_ENV = Symbol("APP_ENV");

/** Parses the given environment, returning a readable list of problems instead of a stack trace. */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): AppEnv {
  const result = Env.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return result.data;
}
