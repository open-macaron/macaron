import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { RepoConfigService } from "../config/repo-config.service.ts";
import { BotIdentity } from "../github/bot-identity.ts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";
import { ReactionTargets } from "../publish/reaction-targets.ts";
import type { ReactionTarget } from "../publish/upstream-writer.ts";
import { ACTIVE_STATUSES, RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import { RunLauncher } from "../runs/run-launcher.ts";
import { Jobs } from "../jobs/jobs.ts";
import { EventsRepository, type NewEvent, QUIET_PERIOD_MS } from "./events.repository.ts";
import { NotificationSink } from "./notifications-poller.ts";
import type { NotificationThread } from "./notifications-source.ts";
import { parseMention, parseSubjectUrl, type Subject } from "./triggers.ts";

/** Comments older than the notification by more than this are not new triggers. */
const LOOKBACK_MS = 15 * 60_000;

/**
 * Turns notifications into trigger events. Untrusted repos and users are ignored silently: no
 * reaction, no reply, no LLM call. Trusted triggers get 👀 right away and are debounced.
 */
@Injectable()
export class IngestService extends NotificationSink {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    private readonly config: RepoConfigService,
    private readonly runs: RunsRepository,
    private readonly events: EventsRepository,
    private readonly reactions: ReactionTargets,
    private readonly launcher: RunLauncher,
    private readonly jobs: Jobs,
    private readonly bot: BotIdentity,
  ) {
    super();
  }

  override async accept(notification: NotificationThread): Promise<void> {
    const subject = parseSubjectUrl(notification.subjectUrl);
    if (subject === undefined || this.config.repo(subject.repo) === undefined) return;

    // On the bot's own PR, everything belongs to the thread that opened it.
    const thread = (subject.kind === "pull" ? await this.runs.threadByPull(subject.repo, subject.number) : undefined) ?? (await this.runs.thread(subject.repo, subject.number, subject.kind));
    const ownPull = subject.kind === "pull" && thread.prNumber === subject.number;
    const since = new Date(notification.updatedAt.getTime() - LOOKBACK_MS);

    const found = [...(await this.issueComments(subject, ownPull, since)), ...(ownPull ? await this.reviewComments(subject, since) : [])];
    let fresh = false;
    for (const candidate of found) {
      const event: NewEvent = { ...candidate.event, threadId: thread.id };
      if (!(await this.events.add(event))) continue;
      this.logger.log(`${subject.repo}#${String(subject.number)}: ${event.kind} by @${event.author}`);
      if (parseMention(event.body, this.bot.identity.login)?.command === "stop") {
        await this.stop(thread);
        continue;
      }
      await this.reactions.start(thread.id, thread.loops + 1, repoRef(subject.repo), candidate.target);
      fresh = true;
    }
    // Every new trigger pushes the thread's processing back: one review is one run.
    if (fresh) await this.jobs.threadReady(thread.id, QUIET_PERIOD_MS);
  }

  /** `/stop` must not wait for the quiet period: spending stops now. */
  private async stop(thread: ThreadRecord): Promise<void> {
    for (const run of await this.runs.loops(thread.id)) {
      if (ACTIVE_STATUSES.includes(run.status)) await this.launcher.abort(run, "stopped on request");
    }
  }

  private async issueComments(subject: Subject, ownPull: boolean, since: Date): Promise<{ event: Omit<NewEvent, "threadId">; target: ReactionTarget }[]> {
    const upstream = repoRef(subject.repo);
    const found: { event: Omit<NewEvent, "threadId">; target: ReactionTarget }[] = [];

    const { data: issue } = await this.gh.rest.issues.get({ ...upstream, issue_number: subject.number });
    const opener = issue.user?.login ?? "";
    if (new Date(issue.created_at) >= since && this.trusted(subject.repo, issue.user) === "user" && parseMention(issue.body ?? "", this.bot.identity.login) !== undefined) {
      found.push({
        event: { externalId: `issue:${String(subject.number)}`, author: opener, kind: "mention", url: issue.html_url, body: issue.body ?? "" },
        target: { kind: "issue", number: subject.number },
      });
    }

    const comments = await this.gh.paginate(this.gh.rest.issues.listComments, { ...upstream, issue_number: subject.number, since: since.toISOString(), per_page: 100 });
    for (const comment of comments) {
      const author = comment.user?.login ?? "";
      const body = comment.body ?? "";
      if (author.toLowerCase() === this.bot.identity.login.toLowerCase()) continue;
      const mention = parseMention(body, this.bot.identity.login) !== undefined;
      const trust = this.trusted(subject.repo, comment.user);
      // Mentions need a trusted user; plain comments only count on the bot's own PR.
      const kind = mention && trust === "user" ? "mention" : ownPull && trust !== undefined ? "comment" : undefined;
      if (kind === undefined) continue;
      found.push({
        event: { externalId: `issue-comment:${String(comment.id)}`, author, kind, url: comment.html_url, body },
        target: { kind: "issue-comment", id: comment.id },
      });
    }
    return found;
  }

  private async reviewComments(subject: Subject, since: Date): Promise<{ event: Omit<NewEvent, "threadId">; target: ReactionTarget }[]> {
    const upstream = repoRef(subject.repo);
    const comments = await this.gh.paginate(this.gh.rest.pulls.listReviewComments, { ...upstream, pull_number: subject.number, since: since.toISOString(), per_page: 100 });
    return comments
      .filter((comment) => this.trusted(subject.repo, comment.user) !== undefined)
      .map((comment) => ({
        event: { externalId: `review-comment:${String(comment.id)}`, author: comment.user.login, kind: "review" as const, url: comment.html_url, body: comment.body },
        target: { kind: "review-comment" as const, id: comment.id },
      }));
  }

  /** The config's trust lists, narrowed by the operator's id allowlist when one is set. */
  private trusted(repo: string, user: { readonly login: string; readonly id: number } | null | undefined): "user" | "bot" | undefined {
    if (user === null || user === undefined) return undefined;
    const allowed = this.env.MACARON_ALLOWED_USER_IDS;
    if (allowed !== undefined && !allowed.has(user.id)) return undefined;
    return this.config.trigger(repo, user.login);
  }
}
