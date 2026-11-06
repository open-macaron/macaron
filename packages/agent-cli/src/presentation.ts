import { ATTACHMENT_REFERENCE, type Attachment, type RunResult } from "@open-macaron/contracts";

type Reply = RunResult["replies"][number];

/**
 * The publisher shows an attachment only where a text references it, and threads a reply only
 * under a review comment: any other reply is quoted into the message, after it.
 */
function placedIds(result: RunResult): Set<string> {
  const texts = [result.message, result.pr?.body, ...result.replies.map((reply) => reply.body)];
  return new Set(texts.flatMap((text) => [...(text?.matchAll(ATTACHMENT_REFERENCE) ?? [])].flatMap((match) => match[1] ?? [])));
}

function unplaced(result: RunResult): Attachment[] {
  const placed = placedIds(result);
  return result.attachments.filter((attachment) => !placed.has(attachment.id));
}

function unthreadable(result: RunResult, reviewCommentIds: ReadonlySet<number>): Reply[] {
  return result.replies.filter((reply) => !reviewCommentIds.has(reply.inReplyTo));
}

/** A caption as image alt text: brackets would end it early. */
function placement(attachment: Attachment): string {
  return `![${attachment.caption.replaceAll(/[[\]]/g, "")}](attachment:${attachment.id})`;
}

/** What makes the result read badly once published, each with the change that fixes it. */
export function presentationProblems(result: RunResult, reviewCommentIds: ReadonlySet<number>): string[] {
  return [
    ...unplaced(result).map((attachment) => `attachment ${attachment.id} is in no text, so it won't be shown: add ${placement(attachment)} to message (or pr.body) where it shows the point`),
    ...unthreadable(result, reviewCommentIds).map(
      (reply) => `the reply to comment ${String(reply.inReplyTo)} can't be threaded (only review comments can): answer it in message and remove it from replies`,
    ),
  ];
}

/**
 * The result with those problems fixed for the agent, once it can no longer fix them itself:
 * failing the run would discard its work over how it reads. A reply that can't be threaded becomes
 * the message when there is none (otherwise the publisher quotes it after the message), and an
 * attachment no text places is added after the text readers see.
 */
export function repairPresentation(result: RunResult, reviewCommentIds: ReadonlySet<number>): RunResult {
  const loose = unthreadable(result, reviewCommentIds);
  const answered =
    (result.message ?? "").length === 0 && loose.length > 0
      ? { ...result, message: loose.map((reply) => reply.body).join("\n\n"), replies: result.replies.filter((reply) => !loose.includes(reply)) }
      : result;
  const missing = unplaced(answered);
  if (missing.length === 0) return answered;
  const gallery = missing.map(placement).join("\n\n");
  if (answered.message === undefined && answered.pr !== undefined) return { ...answered, pr: { ...answered.pr, body: `${answered.pr.body}\n\n${gallery}` } };
  return { ...answered, message: [answered.message, gallery].filter((part) => part !== undefined && part.length > 0).join("\n\n") };
}
