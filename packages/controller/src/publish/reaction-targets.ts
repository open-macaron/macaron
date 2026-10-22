import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { Clock } from "../common/clock.ts";
import { describeError } from "../common/errors.ts";
import { SlidingWindow } from "../common/sliding-window.ts";
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
/** Where 👀 waits until a run claims it: no loop is ever 0. */
const UNCLAIMED_LOOP = 0;
/** `refused:<login>`: 👎 on a mention by someone who may not trigger work, once per thread. */
const REFUSED = "refused:";
/** Refusals belong to no loop: nothing claims, swaps or adopts them. */
const REFUSALS_LOOP = -1;
/** Anyone can mention the bot: strangers must not spend the write quota real work needs. */
const REFUSALS_PER_HOUR = 30;

function targetKey(target: ReactionTarget): string {
  return target.kind === "issue" ? `issue:${String(target.number)}` : `${target.kind}:${String(target.id)}`;
}

/** What a request reacts on, from its event: the comment itself, or the issue / pull request. */
export function reactionTargetOf(event: { readonly externalId: string; readonly subjectNumber: number }): ReactionTarget {
  const [kind, id] = event.externalId.split(":");
  const number = Number(id);
  if (kind === "issue-comment") return { kind: "issue-comment", id: number };
  if (kind === "review-comment") return { kind: "review-comment", id: number };
  // `issue:<n>` and review summaries (GitHub has no reactions on reviews): the subject itself.
  return { kind: "issue", number: event.subjectNumber };
}

/**
 * 👀 on every request when it arrives, swapped for 👍 / 😕 when the loop that answers it ends.
 * Requests on the issue and on a pull request are answered by separate loops, so 👀 waits
 * unclaimed until a loop claims its requests. A mention by someone who may not trigger work gets
 * 👎 instead, so they know they were heard. Reactions are cosmetic: failures are logged, never fatal.
 */
@Injectable()
export class ReactionTargets {
  private readonly logger = new Logger(ReactionTargets.name);
  private readonly refusals: SlidingWindow;

  constructor(
    private readonly runs: RunsRepository,
    private readonly writer: UpstreamWriter,
    clock: Clock,
  ) {
    this.refusals = new SlidingWindow(clock, REFUSALS_PER_HOUR, 3_600_000);
  }

  /** 👀 on a request as it arrives, until a loop claims it. */
  async watch(threadId: string, upstream: RepoRef, target: ReactionTarget): Promise<void> {
    await this.start(threadId, UNCLAIMED_LOOP, upstream, target);
  }

  /** 👎 on a mention by `login`, who may not trigger work: at most once per thread, within the hourly cap. */
  async refuse(threadId: string, upstream: RepoRef, login: string, target: ReactionTarget): Promise<void> {
    if (this.refusals.full()) return;
    try {
      await this.runs.once(threadId, REFUSALS_LOOP, `${REFUSED}${login.toLowerCase()}`, async () => {
        this.refusals.record();
        const reactionId = await this.writer.react(upstream, target, "-1");
        return JSON.stringify({ target, reactionId });
      });
    } catch (error: unknown) {
      this.logger.warn(`👎 failed: ${describeError(error)}`);
    }
  }

  /** The loop that answers these requests takes over their 👀: its outcome replaces them. */
  async claim(threadId: string, targets: readonly ReactionTarget[], loop: number): Promise<void> {
    await this.runs.moveEffects(threadId, UNCLAIMED_LOOP, loop, targets.map((target) => `${EYES}${targetKey(target)}`));
  }

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
