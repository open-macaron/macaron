import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { GH_PUSH, type GitHub } from "../github/github.ts";
import type { RepoRef } from "../github/repo-ref.ts";
import { type RunRecord, RunsRepository, type ThreadRecord } from "../runs/runs.repository.ts";
import type { VettedAttachment } from "./gate.ts";

/** What the upload endpoint answers: the asset's URL on github.com. */
const UserAttachment = z.object({
  url: z.url().refine((url) => url.startsWith("https://github.com/user-attachments/assets/"), "not a GitHub user-attachment URL"),
});

/**
 * Publishes a run's vetted media as GitHub user-attachments: the files GitHub serves for images and
 * videos pasted into issues, which render inline (videos with a player). Same upload as
 * `gh issue comment --attach` (GitHub CLI ≥ 2.99, internal/attachments), made here by the controller
 * with the bot's token; runners never hold one.
 *
 * The endpoint requires write access to the repository the asset is uploaded against (it answers 404
 * otherwise), and the bot only writes to its forks: assets are uploaded against the fork. An asset
 * stays private to the bot until a saved comment references it; then it is public (measured: about
 * 20 s after the comment, on another repository than the fork).
 */
@Injectable()
export class EvidenceHost {
  private readonly repositoryIds = new Map<string, number>();

  constructor(
    @Inject(GH_PUSH) private readonly gh: GitHub,
    private readonly runs: RunsRepository,
  ) {}

  /** Attachment id → URL. Each file is uploaded once per loop (effects), so a retried publish reuses it. */
  async publish(fork: RepoRef, thread: ThreadRecord, run: RunRecord, attachments: readonly VettedAttachment[]): Promise<ReadonlyMap<string, string>> {
    const urls = new Map<string, string>();
    if (attachments.length === 0) return urls;
    const repositoryId = await this.repositoryId(fork);
    for (const attachment of attachments) {
      const kind = `evidence:${attachment.id}`;
      const uploaded = await this.runs.once(thread.id, run.loop, kind, () =>
        uploadUserAttachment(this.gh, repositoryId, `${attachment.id}.${attachment.media.ext}`, attachment.media.mime, attachment.bytes),
      );
      const url = uploaded ?? (await this.runs.effect(thread.id, run.loop, kind));
      if (url === undefined || url === null) throw new Error(`evidence ${attachment.id} of run ${run.id} was claimed but never uploaded`);
      urls.set(attachment.id, url);
    }
    return urls;
  }

  private async repositoryId(fork: RepoRef): Promise<number> {
    const key = `${fork.owner}/${fork.repo}`;
    const cached = this.repositoryIds.get(key);
    if (cached !== undefined) return cached;
    const { data } = await this.gh.rest.repos.get({ ...fork });
    this.repositoryIds.set(key, data.id);
    return data.id;
  }
}

/**
 * One file as a GitHub user-attachment, against `repositoryId` (which the token must be able to
 * write to). Not in Octokit's route types (GitHub documents the CLI flag, not the endpoint): the
 * request goes through our Octokit client (auth, retries, throttling) and the answer is validated.
 */
export async function uploadUserAttachment(gh: GitHub, repositoryId: number, name: string, mime: string, bytes: Uint8Array): Promise<string> {
  const response: { readonly data: unknown } = await gh.request("POST /user-attachments/assets{?name,content_type,repository_id}", {
    baseUrl: "https://uploads.github.com",
    name,
    content_type: mime,
    repository_id: repositoryId,
    headers: { "content-type": mime },
    data: bytes,
  });
  return UserAttachment.parse(response.data).url;
}
