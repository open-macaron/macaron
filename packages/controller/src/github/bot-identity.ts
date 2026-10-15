import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { GH_INTERACT, GH_ORG, GH_PUSH, type GitHub } from "./github.ts";
import { httpStatus } from "./repo-ref.ts";

export interface Identity {
  readonly login: string;
  readonly id: number;
  /** `<id>+<login>@users.noreply.github.com`: attributes commits without exposing an address. */
  readonly email: string;
}

/**
 * Resolves who the three GitHub tokens authenticate as, and refuses to start unless every one
 * belongs to the configured bot. A token created from the wrong account would act as a human:
 * a run dispatched with it fails the OIDC `actor` check, a comment posted with it is signed by
 * the wrong person.
 */
@Injectable()
export class BotIdentity implements OnModuleInit {
  private readonly logger = new Logger(BotIdentity.name);
  private resolved: Identity | undefined;

  constructor(
    @Inject(GH_INTERACT) private readonly interact: GitHub,
    @Inject(GH_PUSH) private readonly push: GitHub,
    @Inject(GH_ORG) private readonly org: GitHub,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    const [interact, push, org] = await Promise.all([
      this.whoIs("GH_INTERACT", this.interact),
      this.whoIs("GH_PUSH", this.push),
      this.whoIs("GH_ORG", this.org),
    ]);
    const expected = this.env.GITHUB_BOT_LOGIN.toLowerCase();
    const wrong = [
      ["GH_INTERACT", interact.login],
      ["GH_PUSH", push.login],
      ["GH_ORG", org.login],
    ].filter(([, login]) => login?.toLowerCase() !== expected);
    if (wrong.length > 0) {
      const detail = wrong.map(([name, login]) => `${String(name)} belongs to "${String(login)}"`).join(", ");
      throw new Error(`every GitHub token must belong to "${this.env.GITHUB_BOT_LOGIN}": ${detail}`);
    }
    this.resolved = { login: interact.login, id: interact.id, email: `${String(interact.id)}+${interact.login}@users.noreply.github.com` };
    this.logger.log(`acting as ${interact.login} (${String(interact.id)}), all three tokens verified`);
  }

  get identity(): Identity {
    if (this.resolved === undefined) throw new Error("bot identity not resolved yet");
    return this.resolved;
  }

  private async whoIs(name: string, gh: GitHub): Promise<{ login: string; id: number }> {
    try {
      const { data } = await gh.rest.users.getAuthenticated();
      return { login: data.login, id: data.id };
    } catch (error: unknown) {
      throw new Error(`${name} was refused by GitHub (HTTP ${String(httpStatus(error) ?? "n/a")}): invalid, expired or revoked token`, { cause: error });
    }
  }
}
