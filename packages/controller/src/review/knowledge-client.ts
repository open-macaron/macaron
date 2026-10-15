import { Inject, Injectable } from "@nestjs/common";
import { type CommitSha, KnowledgeSlice, type PublishedRule, type RepoConfig } from "@open-macaron/contracts";
import { UpstreamError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";

export interface RepoRules {
  /** The knowledge commit the most specific slice was built from; null when the repo has no slice at all. */
  readonly commit: CommitSha | null;
  /** global → project → repo. Ids are unique across levels by construction (`<scope>/<slug>`). */
  readonly rules: readonly PublishedRule[];
}

/**
 * Reads open-macaron/knowledge's GitHub Pages read API (DESIGN.md §6.5). One file per level; this
 * client merges them, because which project a repo belongs to is our configuration, not theirs.
 * Slices are cached by ETag: an unchanged slice costs a 304.
 */
@Injectable()
export class KnowledgeClient {
  private readonly cache = new Map<string, { readonly etag: string; readonly slice: KnowledgeSlice }>();

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async rulesFor(config: Pick<RepoConfig, "project" | "repo">): Promise<RepoRules> {
    const slices = await Promise.all(["global.json", `projects/${config.project}.json`, `repos/${config.repo}.json`].map((path) => this.slice(path)));
    const present = slices.filter((slice): slice is KnowledgeSlice => slice !== undefined);
    return { commit: present.at(-1)?.commit ?? null, rules: present.flatMap((slice) => slice.rules) };
  }

  /** A missing slice (404) is a level without knowledge yet, not an error. */
  private async slice(path: string): Promise<KnowledgeSlice | undefined> {
    const url = `${this.env.KNOWLEDGE_URL}/${path}`;
    const cached = this.cache.get(url);
    const response = await fetch(url, {
      headers: cached === undefined ? {} : { "if-none-match": cached.etag },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304 && cached !== undefined) return cached.slice;
    if (response.status === 404) {
      this.cache.delete(url);
      return undefined;
    }
    if (!response.ok) throw new UpstreamError("knowledge", `${path}: HTTP ${String(response.status)}`, response.status);
    const parsed = KnowledgeSlice.safeParse(await response.json());
    if (!parsed.success) throw new UpstreamError("knowledge", `${path}: not a knowledge slice`, response.status);
    const etag = response.headers.get("etag");
    if (etag !== null) this.cache.set(url, { etag, slice: parsed.data });
    return parsed.data;
  }
}
