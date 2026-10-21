import { Inject, Injectable } from "@nestjs/common";
import type { RepoConfig } from "@open-macaron/contracts";
import { type Knowledge, KnowledgeSource, KnowledgeUnavailable, type ReviewRules } from "@open-macaron/review";
import { UpstreamError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";

/**
 * The knowledge of a configured repository: global → its project → the repository
 * (@open-macaron/review's KnowledgeSource, ETag-cached for the controller's lifetime).
 */
@Injectable()
export class KnowledgeClient {
  private readonly source: KnowledgeSource;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.source = new KnowledgeSource(env.KNOWLEDGE_URL);
  }

  async rulesFor(config: Pick<RepoConfig, "project" | "repo">): Promise<ReviewRules> {
    const { commit, rules } = await this.knowledgeFor(config);
    return { commit, rules };
  }

  /** Rules and lessons at one commit. */
  async knowledgeFor(config: Pick<RepoConfig, "project" | "repo">): Promise<Knowledge> {
    try {
      return await this.source.knowledge({ project: config.project, repo: config.repo });
    } catch (error: unknown) {
      if (error instanceof KnowledgeUnavailable) throw new UpstreamError("knowledge", error.message, error.status, { cause: error });
      throw error;
    }
  }
}
