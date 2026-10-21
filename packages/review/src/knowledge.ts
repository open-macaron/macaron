import { type CommitSha, KnowledgeSlice, type PublishedLesson, type PublishedRule } from "@open-macaron/contracts";

export const DEFAULT_KNOWLEDGE_URL = "https://open-macaron.github.io/knowledge/v1";

export interface ReviewRules {
  /** The knowledge commit the most specific slice was built from; null when no slice exists. */
  readonly commit: CommitSha | null;
  /** global → project → repo. Ids are unique across levels by construction (`<scope>/<slug>`). */
  readonly rules: readonly PublishedRule[];
}

/** What a repository's runs get: its rules and lessons, global → project → repo, at one commit. */
export interface Knowledge extends ReviewRules {
  readonly lessons: readonly PublishedLesson[];
}

/** The read API couldn't be read (HTTP error, unexpected content). */
export class KnowledgeUnavailable extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = "KnowledgeUnavailable";
  }
}

/** Which levels to read besides `global`. Which project a repository belongs to is the caller's business. */
export interface KnowledgeScopes {
  readonly project?: string | undefined;
  readonly repo?: string | undefined;
}

/**
 * open-macaron/knowledge's read API (GitHub Pages, DESIGN.md §6.5): one file per level, merged here.
 * Which project a repository belongs to isn't the knowledge repository's business: the caller says.
 * Slices are cached by ETag, so a long-lived source (the controller) pays a 304 for unchanged ones.
 */
export class KnowledgeSource {
  private readonly cache = new Map<string, { readonly etag: string; readonly slice: KnowledgeSlice }>();

  constructor(private readonly baseUrl: string = DEFAULT_KNOWLEDGE_URL) {}

  async rules(options: KnowledgeScopes): Promise<ReviewRules> {
    const { commit, rules } = await this.knowledge(options);
    return { commit, rules };
  }

  async knowledge(options: KnowledgeScopes): Promise<Knowledge> {
    const paths = ["global.json"];
    if (options.project !== undefined) paths.push(`projects/${options.project}.json`);
    if (options.repo !== undefined) paths.push(`repos/${options.repo}.json`);
    const slices = await Promise.all(paths.map((path) => this.slice(path)));
    const present = slices.filter((slice): slice is KnowledgeSlice => slice !== undefined);
    return { commit: present.at(-1)?.commit ?? null, rules: present.flatMap((slice) => slice.rules), lessons: present.flatMap((slice) => slice.lessons) };
  }

  /** A missing slice (404) is a level without knowledge yet, not an error. */
  private async slice(path: string): Promise<KnowledgeSlice | undefined> {
    const url = `${this.baseUrl}/${path}`;
    const cached = this.cache.get(url);
    const response = await fetch(url, { headers: cached === undefined ? {} : { "if-none-match": cached.etag }, signal: AbortSignal.timeout(15_000) });
    if (response.status === 304 && cached !== undefined) return cached.slice;
    if (response.status === 404) {
      this.cache.delete(url);
      return undefined;
    }
    if (!response.ok) throw new KnowledgeUnavailable(`${path}: HTTP ${String(response.status)}`, response.status);
    const parsed = KnowledgeSlice.safeParse(await response.json());
    if (!parsed.success) throw new KnowledgeUnavailable(`${path}: not a knowledge slice`, response.status);
    const etag = response.headers.get("etag");
    if (etag !== null) this.cache.set(url, { etag, slice: parsed.data });
    return parsed.data;
  }
}
