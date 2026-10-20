import { Inject, Injectable } from "@nestjs/common";
import { createRemoteJWKSet, errors as joseErrors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { OidcRejected } from "../common/errors.ts";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

/** Resolves the signing keys of GitHub's OIDC issuer. Swappable in tests. */
export const OIDC_KEYS = Symbol("OIDC_KEYS");

export function githubJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`), { cooldownDuration: 60_000 });
}

/** GitHub sends numeric ids as strings. */
const NumericString = z.string().regex(/^[0-9]+$/).transform(Number);

const ActionsClaims = z.looseObject({
  repository: z.string(),
  repository_id: NumericString,
  repository_owner_id: NumericString,
  workflow_ref: z.string(),
  event_name: z.string(),
  actor: z.string(),
  runner_environment: z.string(),
  run_id: NumericString,
  run_attempt: NumericString,
});

export interface VerifiedRun {
  readonly runId: number;
  readonly runAttempt: number;
}

/**
 * Verifies a GitHub Actions OIDC token and checks it comes from our runner workflow:
 * immutable repository and owner ids, the exact workflow file on main, a workflow_dispatch by the bot,
 * on a GitHub-hosted runner.
 */
@Injectable()
export class OidcVerifier {
  private readonly expectedWorkflowRef: string;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OIDC_KEYS) private readonly keys: JWTVerifyGetKey,
  ) {
    this.expectedWorkflowRef = `${env.RUNNER_REPO}/.github/workflows/${env.RUNNER_WORKFLOW}@refs/heads/main`;
  }

  async verify(token: string): Promise<VerifiedRun> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: GITHUB_OIDC_ISSUER,
        audience: this.env.PUBLIC_URL,
        algorithms: ["RS256"],
        maxTokenAge: "10m",
      }));
    } catch (error: unknown) {
      const reason = error instanceof joseErrors.JOSEError ? error.code : "unverifiable token";
      throw new OidcRejected(`token rejected: ${reason}`);
    }

    const parsed = ActionsClaims.safeParse(payload);
    if (!parsed.success) throw new OidcRejected("token is not a GitHub Actions token");
    const claims = parsed.data;

    const mismatches = [
      claims.repository_id !== this.env.RUNNER_REPO_ID && "repository_id",
      claims.repository_owner_id !== this.env.RUNNER_OWNER_ID && "repository_owner_id",
      claims.workflow_ref !== this.expectedWorkflowRef && "workflow_ref",
      claims.event_name !== "workflow_dispatch" && "event_name",
      claims.actor !== this.env.GITHUB_BOT_LOGIN && "actor",
      // A runner label in the configuration must never send a run, and its key, to a machine we don't control.
      claims.runner_environment !== "github-hosted" && "runner_environment",
    ].filter((field): field is string => field !== false);
    if (mismatches.length > 0) throw new OidcRejected(`unexpected claims: ${mismatches.join(", ")}`);

    return { runId: claims.run_id, runAttempt: claims.run_attempt };
  }
}
