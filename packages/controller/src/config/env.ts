import { z } from "zod";
import { RepoSlug } from "@open-macaron/contracts";

const Secret = z.string().min(20, "looks too short to be a real credential");

/** Every environment variable the controller reads. Parsed once at boot; the process exits if invalid. */
export const Env = z.object({
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
  EVIDENCE_REPO: RepoSlug.default(RepoSlug.parse("open-macaron/evidence")),

  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_PROVISIONING_KEY: Secret,
  OPENROUTER_ROUTER_KEY: Secret,

  WEBHOOK_HMAC: z.string().min(32, "use at least 32 random characters"),
});
export type AppEnv = z.infer<typeof Env>;

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
