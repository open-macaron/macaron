import { randomInt } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type ConfigSnapshot, type RepoConfig, repoKey, type RepoSlug } from "@open-macaron/contracts";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { DomainError } from "../common/errors.ts";
import { OnboardingNotice } from "../config/onboarding-notice.ts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import type { Db } from "../db/db.module.ts";
import { forks } from "../db/schema.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { httpStatus, type RepoRef, repoRef } from "../github/repo-ref.ts";
import { EnsureForkJob, Jobs, Queue } from "../jobs/jobs.ts";

/** A fork the controller recorded for an upstream. */
export interface ForkRow {
  readonly upstreamId: number;
  readonly upstreamKey: string;
  readonly forkId: number;
  readonly forkName: string;
  readonly readyAt: Date | null;
}

/** Persistence of the forks; abstract so the registry can be tested without a database. */
export abstract class ForkStore {
  abstract byUpstream(upstreamId: number): Promise<ForkRow | undefined>;
  /** The fork's name, once ready, of the upstream configured as `key` (lower-cased `owner/name`). */
  abstract readyName(key: string): Promise<string | undefined>;
  /** Records the fork of an upstream, not ready; a row left by an upstream renamed since gives up its key. */
  abstract record(row: Omit<ForkRow, "readyAt">): Promise<void>;
  /** Marks the fork ready; true if it wasn't before. */
  abstract markReady(upstreamId: number): Promise<boolean>;
}

@Injectable()
export class DrizzleForkStore extends ForkStore {
  constructor(@InjectDrizzle() private readonly db: Db) {
    super();
  }

  override async byUpstream(upstreamId: number): Promise<ForkRow | undefined> {
    const [row] = await this.db.select().from(forks).where(eq(forks.upstreamId, upstreamId));
    return row;
  }

  override async readyName(key: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ forkName: forks.forkName })
      .from(forks)
      .where(and(eq(forks.upstreamKey, key), isNotNull(forks.readyAt)));
    return row?.forkName;
  }

  override async record(row: Omit<ForkRow, "readyAt">): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(forks).where(and(eq(forks.upstreamKey, row.upstreamKey), ne(forks.upstreamId, row.upstreamId)));
      await tx
        .insert(forks)
        .values(row)
        .onConflictDoUpdate({ target: forks.upstreamId, set: { upstreamKey: row.upstreamKey, forkId: row.forkId, forkName: row.forkName } });
    });
  }

  override async markReady(upstreamId: number): Promise<boolean> {
    const updated = await this.db
      .update(forks)
      .set({ readyAt: new Date() })
      .where(and(eq(forks.upstreamId, upstreamId), isNull(forks.readyAt)))
      .returning({ upstreamId: forks.upstreamId });
    return updated.length > 0;
  }
}

/** Why a repository can't have a fork: retrying won't help until its configuration or GitHub changes. */
export class ForkUnavailable extends DomainError {
  readonly code = "fork_unavailable";
}

/** The repository fields the checks read, from any of GitHub's repository endpoints. */
const Repository = z.object({
  id: z.int().positive(),
  name: z.string(),
  full_name: z.string(),
  html_url: z.url(),
  private: z.boolean(),
  fork: z.boolean(),
  owner: z.object({ id: z.int(), login: z.string() }),
  // The root of the fork network, on forks only.
  source: z.object({ id: z.int().positive() }).optional(),
  has_wiki: z.boolean().optional(),
  has_issues: z.boolean().optional(),
  has_projects: z.boolean().optional(),
});
type Repository = z.infer<typeof Repository>;

const ActionsPermissions = z.object({ enabled: z.boolean() });

export interface EnsuredFork {
  readonly fork: RepoRef;
  readonly url: string;
  /** The fork just became usable for this upstream: what onboarding announces. */
  readonly firstReady: boolean;
}

/** `<6 random lowercase chars>-<upstream name>`, so two upstreams with the same name never collide. */
export function forkName(upstream: RepoSlug): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const prefix = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${prefix}-${repoRef(upstream).repo}`.slice(0, 100);
}

/**
 * The bot's fork of every configured upstream. The configuration only says which upstreams are
 * trusted: the controller picks the name, forks, switches off what a fork must not run (Actions)
 * or expose (wiki, issues, projects), and records it by repository id. A fork is accepted only if
 * the bot owns it and it belongs to the upstream's fork network (GitHub allows one fork per network,
 * so a fork of another member is returned, and shared). Nothing pushes to a fork before it is ready.
 */
@Injectable()
export class ForkRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(ForkRegistry.name);

  constructor(
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    private readonly bot: BotIdentity,
    private readonly store: ForkStore,
    private readonly config: RepoConfigService,
    private readonly jobs: Jobs,
    private readonly notice: OnboardingNotice,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(Queue.ensureFork, EnsureForkJob, async ({ repo }) => {
      await this.onboard(repo);
    });
    this.config.onApplied((snapshot) => this.enqueueAll(snapshot));
    await this.enqueueAll(this.config.snapshot);
  }

  /** The upstream's ready fork, or undefined while it is being created (or can't be). */
  async of(upstream: string): Promise<RepoRef | undefined> {
    const name = await this.store.readyName(repoKey(upstream));
    return name === undefined ? undefined : { owner: this.bot.identity.login, repo: name };
  }

  /** Like `of`, for steps that only run after a fork was found ready (publishing a run's result). */
  async require(upstream: string): Promise<RepoRef> {
    const fork = await this.of(upstream);
    if (fork === undefined) throw new ForkUnavailable(`${upstream} has no ready fork`);
    return fork;
  }

  /**
   * Finds or creates the upstream's fork and secures it. Idempotent. Throws ForkUnavailable when
   * no fork can be accepted, anything else (GitHub still creating the fork) to be retried.
   */
  async ensure(config: RepoConfig): Promise<EnsuredFork> {
    const upstream = await this.upstream(config.repo);
    const network = upstream.source?.id ?? upstream.id;
    const known = await this.store.byUpstream(upstream.id);
    const fork = (known === undefined ? undefined : await this.byId(known.forkId)) ?? (await this.create(config.repo));
    if (fork.owner.id !== this.bot.identity.id || !fork.fork || fork.source?.id !== network) {
      throw new ForkUnavailable(`${fork.full_name} is not ${this.bot.identity.login}'s fork of ${upstream.full_name}'s network`);
    }
    await this.store.record({ upstreamId: upstream.id, upstreamKey: repoKey(config.repo), forkId: fork.id, forkName: fork.name });
    await this.secure(fork);
    const firstReady = await this.store.markReady(upstream.id);
    return { fork: { owner: fork.owner.login, repo: fork.name }, url: fork.html_url, firstReady };
  }

  /** The job: ensure, then tell the configuration's pull request how it went. */
  private async onboard(repo: RepoSlug): Promise<void> {
    const config = this.config.repo(repo);
    if (config === undefined) return;
    try {
      const ensured = await this.ensure(config);
      if (ensured.firstReady) {
        this.logger.log(`${repo}: fork ${ensured.url} ready`);
        await this.notice.onboarded(config.repo, ensured.url);
      }
    } catch (error: unknown) {
      if (!(error instanceof ForkUnavailable)) throw error;
      this.logger.error(`${repo}: no fork: ${error.message}`);
      await this.notice.failed(config.repo, error.message);
    }
  }

  private async enqueueAll(snapshot: ConfigSnapshot): Promise<void> {
    for (const config of snapshot.repos.values()) await this.jobs.ensureFork(config.repo);
  }

  private async upstream(slug: RepoSlug): Promise<Repository> {
    let data: unknown;
    try {
      ({ data } = await this.gh.rest.repos.get({ ...repoRef(slug) }));
    } catch (error: unknown) {
      if (httpStatus(error) === 404) throw new ForkUnavailable(`${slug} doesn't exist or isn't public`);
      throw error;
    }
    const upstream = Repository.parse(data);
    if (upstream.private) throw new ForkUnavailable(`${slug} isn't public`);
    return upstream;
  }

  /** A recorded fork, or undefined if it is gone (deleted by hand): it is then created again. */
  private async byId(id: number): Promise<Repository | undefined> {
    try {
      const response: { readonly data: unknown } = await this.gh.request("GET /repositories/{repository_id}", { repository_id: id });
      return Repository.parse(response.data);
    } catch (error: unknown) {
      if (httpStatus(error) === 404) return undefined;
      throw error;
    }
  }

  /** GitHub answers with the bot's existing fork of the network if there is one, under its own name. */
  private async create(slug: RepoSlug): Promise<Repository> {
    try {
      const { data } = await this.gh.rest.repos.createFork({ ...repoRef(slug), name: forkName(slug), default_branch_only: true });
      return Repository.parse(data);
    } catch (error: unknown) {
      const status = httpStatus(error);
      if (status === 403 || status === 404 || status === 422) {
        throw new ForkUnavailable(`GitHub refused to fork ${slug} (${String(status)}): ${error instanceof Error ? error.message : "unknown"}`);
      }
      throw error;
    }
  }

  /**
   * Actions off (a fork's workflows would run with our pushes), wiki, issues and projects off. Checked
   * every time, written only when they differ. A fork GitHub is still creating answers 404: retried.
   */
  private async secure(fork: Repository): Promise<void> {
    const ref = { owner: fork.owner.login, repo: fork.name } satisfies RepoRef;
    if (fork.has_wiki !== false || fork.has_issues !== false || fork.has_projects !== false) {
      await this.gh.rest.repos.update({ ...ref, has_wiki: false, has_issues: false, has_projects: false });
    }
    const { data } = await this.gh.rest.actions.getGithubActionsPermissionsRepository({ ...ref });
    if (ActionsPermissions.parse(data).enabled) await this.gh.rest.actions.setGithubActionsPermissionsRepository({ ...ref, enabled: false });
  }
}
