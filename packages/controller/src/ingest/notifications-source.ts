import { Inject, Injectable } from "@nestjs/common";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { parsePollHeaders, type PollOutcome } from "./poll-policy.ts";

export interface NotificationThread {
  readonly id: string;
  readonly reason: string;
  readonly repo: string;
  readonly subjectType: string;
  readonly subjectUrl: string | null;
  readonly latestCommentUrl: string | null;
  readonly title: string;
  readonly updatedAt: Date;
}

export interface PollResult {
  readonly outcome: PollOutcome;
  readonly threads: readonly NotificationThread[];
}

const PER_PAGE = 50;
/** One poll is one logical request; more pages mean the inbox isn't being drained (warned upstream). */
const MAX_PAGES = 10;

interface HttpError {
  readonly status: number;
  readonly response?: { readonly headers: Readonly<Record<string, string | number | undefined>> };
}

function isHttpError(error: unknown): error is HttpError {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number";
}

/** Port the poller depends on; NotificationsSource is the GitHub implementation. */
export abstract class NotificationsApi {
  /** Exactly one logical request. Never retries: pacing belongs to poll-policy.ts. */
  abstract fetch(lastModified: string | null): Promise<PollResult>;
  abstract markRead(threadId: string): Promise<void>;
}

/**
 * The only code allowed to call GET /notifications. Every call is a single attempt:
 * pacing and retries are decided by poll-policy.ts, never by the HTTP client.
 */
@Injectable()
export class NotificationsSource extends NotificationsApi {
  constructor(@Inject(GH_INTERACT) private readonly gh: GitHub) {
    super();
  }

  override async fetch(lastModified: string | null): Promise<PollResult> {
    const threads: NotificationThread[] = [];
    try {
      let headers: Readonly<Record<string, string | number | undefined>> = {};
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await this.gh.rest.activity.listNotificationsForAuthenticatedUser({
          participating: true,
          per_page: PER_PAGE,
          page,
          headers: page === 1 && lastModified !== null ? { "if-modified-since": lastModified } : {},
          request: { retries: 0 },
        });
        if (page === 1) headers = response.headers;
        for (const item of response.data) {
          threads.push({
            id: item.id,
            reason: item.reason,
            repo: item.repository.full_name,
            subjectType: item.subject.type,
            subjectUrl: item.subject.url,
            latestCommentUrl: item.subject.latest_comment_url,
            title: item.subject.title,
            updatedAt: new Date(item.updated_at),
          });
        }
        if (response.data.length < PER_PAGE || !(response.headers.link ?? "").includes('rel="next"')) break;
      }
      return { outcome: { kind: "modified", headers: parsePollHeaders(headers) }, threads };
    } catch (error: unknown) {
      if (!isHttpError(error)) throw error;
      const headers = parsePollHeaders(error.response?.headers ?? {});
      return error.status === 304
        ? { outcome: { kind: "not-modified", headers }, threads: [] }
        : { outcome: { kind: "error", headers }, threads: [] };
    }
  }

  override async markRead(threadId: string): Promise<void> {
    await this.gh.rest.activity.markThreadAsRead({ thread_id: Number(threadId) });
  }
}
