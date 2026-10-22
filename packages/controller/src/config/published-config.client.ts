import { Inject, Injectable } from "@nestjs/common";
import { type CommitSha, PublishedConfig } from "@open-macaron/contracts";
import { UpstreamError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "./env.ts";

/** What a fetch found: a snapshot, or the one already held (ETag match). */
export type PublishedFetch = { readonly changed: true; readonly config: PublishedConfig } | { readonly changed: false };

/**
 * open-macaron/config's snapshot on GitHub Pages. Its content is trusted as much as that
 * repository's main branch (owner-approved merges, Pages deployed from main only), and validated
 * here like any input: schema now, then the same checks as a local tree (parseConfigTree).
 */
@Injectable()
export class PublishedConfigClient {
  private etag: string | undefined;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  /**
   * The current snapshot. With `commit` (a Pages deployment just reported it), the request skips
   * Pages' CDN cache and the snapshot must be that commit: an older one means "not live yet", not
   * "go back". Without it, an unchanged snapshot costs a 304.
   */
  async fetch(commit?: CommitSha): Promise<PublishedFetch> {
    const settings = this.env.publishedConfig;
    if (settings === undefined) throw new Error("CONFIG_URL is not set");
    const url = new URL("config.json", `${settings.url.replace(/\/$/, "")}/`);
    if (commit !== undefined) url.searchParams.set("commit", commit);
    const headers: Record<string, string> = commit === undefined && this.etag !== undefined ? { "if-none-match": this.etag } : {};

    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    } catch (error: unknown) {
      throw new UpstreamError("config", `${url.pathname} unreachable`, undefined, { cause: error });
    }
    if (response.status === 304) return { changed: false };
    if (!response.ok) throw new UpstreamError("config", `${url.pathname} answered ${String(response.status)}`, response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      throw new UpstreamError("config", `${url.pathname} is not JSON`, response.status, { cause: error });
    }
    const parsed = PublishedConfig.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamError("config", `${url.pathname} is not a published configuration: ${parsed.error.issues[0]?.message ?? "invalid"}`, response.status);
    }
    if (commit !== undefined && parsed.data.commit !== commit) {
      throw new UpstreamError("config", `${url.pathname} serves ${parsed.data.commit}, not ${commit} yet`, response.status);
    }
    const etag = response.headers.get("etag");
    this.etag = etag ?? undefined;
    return { changed: true, config: parsed.data };
  }
}
