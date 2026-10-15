import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { describeError } from "../common/errors.ts";
import type { RepoRef } from "../github/repo-ref.ts";
import { RunsRepository } from "../runs/runs.repository.ts";
import { type ReactionContent, type ReactionTarget, UpstreamWriter } from "./upstream-writer.ts";

/** Stored as the `eyes` effect's external id: what we reacted on, and the reaction to remove later. */
const EyesRecord = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("issue"), number: z.int().positive() }),
    z.object({ kind: z.literal("issue-comment"), id: z.int().positive() }),
    z.object({ kind: z.literal("review-comment"), id: z.int().positive() }),
  ]),
  reactionId: z.int().positive(),
});

/**
 * 👀 when work starts, swapped for 👍 / 😕 when it ends. Reactions are cosmetic: failures are
 * logged, never fatal.
 */
@Injectable()
export class ReactionTargets {
  private readonly logger = new Logger(ReactionTargets.name);

  constructor(
    private readonly runs: RunsRepository,
    private readonly writer: UpstreamWriter,
  ) {}

  async start(threadId: string, loop: number, upstream: RepoRef, target: ReactionTarget): Promise<void> {
    try {
      await this.runs.once(threadId, loop, "eyes", async () => {
        const reactionId = await this.writer.react(upstream, target, "eyes");
        return JSON.stringify({ target, reactionId });
      });
    } catch (error: unknown) {
      this.logger.warn(`👀 failed: ${describeError(error)}`);
    }
  }

  async finish(threadId: string, loop: number, upstream: RepoRef, outcome: ReactionContent): Promise<void> {
    try {
      const stored = await this.runs.effect(threadId, loop, "eyes");
      if (stored === undefined || stored === null) return;
      const record = EyesRecord.parse(JSON.parse(stored));
      await this.runs.once(threadId, loop, `reaction:${outcome}`, async () => {
        await this.writer.react(upstream, record.target, outcome);
        await this.writer.unreact(upstream, record.target, record.reactionId);
        return null;
      });
    } catch (error: unknown) {
      this.logger.warn(`final reaction failed: ${describeError(error)}`);
    }
  }
}
