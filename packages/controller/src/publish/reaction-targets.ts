import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { describeError } from "../common/errors.ts";
import type { RepoRef } from "../github/repo-ref.ts";
import { RunsRepository } from "../runs/runs.repository.ts";
import { type ReactionContent, type ReactionTarget, UpstreamWriter } from "./upstream-writer.ts";

/** Stored as an effect's external id: what we reacted on, and the reaction to remove later. */
const ReactionRecord = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("issue"), number: z.int().positive() }),
    z.object({ kind: z.literal("issue-comment"), id: z.int().positive() }),
    z.object({ kind: z.literal("review-comment"), id: z.int().positive() }),
  ]),
  reactionId: z.int().positive(),
});

/** Effect kinds: `eyes:<target>` when work starts, `outcome:<target>` when it ends. */
const EYES = "eyes:";
const OUTCOME = "outcome:";

function targetKey(target: ReactionTarget): string {
  return target.kind === "issue" ? `issue:${String(target.number)}` : `${target.kind}:${String(target.id)}`;
}

/**
 * 👀 on every trigger when work starts, swapped for 👍 / 😕 when its loop ends. Reactions are
 * cosmetic: failures are logged, never fatal.
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
      await this.runs.once(threadId, loop, `${EYES}${targetKey(target)}`, async () => {
        const reactionId = await this.writer.react(upstream, target, "eyes");
        return JSON.stringify({ target, reactionId });
      });
    } catch (error: unknown) {
      this.logger.warn(`👀 failed: ${describeError(error)}`);
    }
  }

  async finish(threadId: string, loop: number, upstream: RepoRef, outcome: ReactionContent): Promise<void> {
    for (const record of await this.records(threadId, loop, EYES)) {
      try {
        await this.runs.once(threadId, loop, `${OUTCOME}${targetKey(record.target)}`, async () => {
          const reactionId = await this.writer.react(upstream, record.target, outcome);
          await this.writer.unreact(upstream, record.target, record.reactionId);
          return JSON.stringify({ target: record.target, reactionId });
        });
      } catch (error: unknown) {
        this.logger.warn(`final reaction failed: ${describeError(error)}`);
      }
    }
  }

  /** A retry takes over the triggers of the loop it reruns: their 👍 / 😕 goes, 👀 comes back. */
  async adopt(threadId: string, fromLoop: number, toLoop: number, upstream: RepoRef): Promise<void> {
    for (const record of await this.records(threadId, fromLoop, OUTCOME)) {
      try {
        await this.writer.unreact(upstream, record.target, record.reactionId);
      } catch (error: unknown) {
        this.logger.warn(`removing a previous reaction failed: ${describeError(error)}`);
      }
      await this.start(threadId, toLoop, upstream, record.target);
    }
  }

  private async records(threadId: string, loop: number, prefix: string): Promise<z.infer<typeof ReactionRecord>[]> {
    const rows = await this.runs.effectsWithPrefix(threadId, loop, prefix);
    return rows.flatMap((row) => {
      const parsed = ReactionRecord.safeParse(JSON.parse(row.externalId ?? "null"));
      return parsed.success ? [parsed.data] : [];
    });
  }
}
