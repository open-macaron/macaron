import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { GH_INTERACT, type GitHub } from "./github.ts";

export interface Identity {
  readonly login: string;
  readonly id: number;
  /** `<id>+<login>@users.noreply.github.com`: attributes commits without exposing an address. */
  readonly email: string;
}

/**
 * Resolves who GH_INTERACT authenticates as, and refuses to start if it isn't the configured bot.
 * A token pasted from the wrong account would otherwise act as a human.
 */
@Injectable()
export class BotIdentity implements OnModuleInit {
  private readonly logger = new Logger(BotIdentity.name);
  private resolved: Identity | undefined;

  constructor(
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    const { data } = await this.gh.rest.users.getAuthenticated();
    if (data.login.toLowerCase() !== this.env.GITHUB_BOT_LOGIN.toLowerCase()) {
      throw new Error(`GH_INTERACT authenticates as "${data.login}", expected "${this.env.GITHUB_BOT_LOGIN}"`);
    }
    this.resolved = { login: data.login, id: data.id, email: `${String(data.id)}+${data.login}@users.noreply.github.com` };
    this.logger.log(`acting as ${data.login} (${String(data.id)})`);
  }

  get identity(): Identity {
    if (this.resolved === undefined) throw new Error("bot identity not resolved yet");
    return this.resolved;
  }
}
