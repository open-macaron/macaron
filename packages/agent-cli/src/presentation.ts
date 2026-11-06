import { ATTACHMENT_REFERENCE, type Attachment, type RunResult } from "@open-macaron/contracts";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";

type Reply = RunResult["replies"][number];

/** Where a text references an attachment, and whether it shows there as a picture. */
interface Reference {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly shown: boolean;
}

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

/** An image breaks the text it sits in: it reads well only on a line of its own (in a list item too). */
function aloneOnLine(siblings: readonly Nodes[], index: number): boolean {
  const before = siblings[index - 1];
  const after = siblings[index + 1];
  const endsLine = before === undefined || before.type === "break" || (before.type === "text" && (before.value.split("\n").at(-1) ?? "").trim() === "");
  const startsLine = after === undefined || after.type === "break" || (after.type === "text" && (after.value.split("\n")[0] ?? "").trim() === "");
  return endsLine && startsLine;
}

function attachmentId(url: string): string | undefined {
  const id = [...url.matchAll(ATTACHMENT_REFERENCE)][0]?.[1];
  return url === `attachment:${String(id)}` ? id : undefined;
}

/**
 * Every reference in a text. Only an image alone on its line shows the attachment well: GitHub
 * renders a link as a link, and an image inside a sentence breaks it.
 */
function references(text: string): Reference[] {
  const found: Reference[] = [];
  visit(fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), (node, index, parent) => {
    if (node.type !== "image" && node.type !== "link") return;
    const id = attachmentId(node.url);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (id === undefined || start === undefined || end === undefined) return;
    found.push({ id, start, end, shown: node.type === "image" && parent !== undefined && index !== undefined && aloneOnLine(parent.children, index) });
  });
  for (const match of text.matchAll(ATTACHMENT_REFERENCE)) {
    const id = match[1];
    if (id === undefined || found.some((reference) => reference.start <= match.index && match.index < reference.end)) continue;
    found.push({ id, start: match.index, end: match.index + match[0].length, shown: false });
  }
  return found;
}

function misplacedIds(result: RunResult): string[] {
  const texts = [result.message, result.pr?.body, ...result.replies.map((reply) => reply.body)];
  return [...new Set(texts.flatMap((text) => (text === undefined ? [] : references(text).filter((reference) => !reference.shown).map((reference) => reference.id))))];
}

/** The text without its misplaced references, and the parentheses one leaves empty: they're shown after it instead. */
function withoutMisplaced(text: string): string {
  return references(text)
    .filter((reference) => !reference.shown)
    .map(({ start, end }) => (text[start - 1] === "(" && text[end] === ")" ? { start: text[start - 2] === " " ? start - 2 : start - 1, end: end + 1 } : { start, end }))
    .sort((a, b) => b.start - a.start)
    .reduce((edited, { start, end }) => edited.slice(0, start) + edited.slice(end), text);
}

function unthreadable(result: RunResult, reviewCommentIds: ReadonlySet<number>): Reply[] {
  return result.replies.filter((reply) => !reviewCommentIds.has(reply.inReplyTo));
}

/** A caption as image alt text: brackets would end it early. */
function placement(attachment: Attachment): string {
  return `![${attachment.caption.replaceAll(/[[\]]/g, "")}](attachment:${attachment.id})`;
}

function placementOf(result: RunResult, id: string): string {
  const attachment = result.attachments.find((candidate) => candidate.id === id);
  return attachment === undefined ? `![caption](attachment:${id})` : placement(attachment);
}

/** What makes the result read badly once published, each with the change that fixes it. */
export function presentationProblems(result: RunResult, reviewCommentIds: ReadonlySet<number>): string[] {
  return [
    ...misplacedIds(result).map(
      (id) => `attachment ${id} is linked or inside a sentence, so it won't read as a picture: replace it with ${placementOf(result, id)} on a line of its own, after the text it illustrates`,
    ),
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
 * attachment no text places, or places badly, is shown after the text readers see.
 */
export function repairPresentation(original: RunResult, reviewCommentIds: ReadonlySet<number>): RunResult {
  const result: RunResult = {
    ...original,
    ...(original.message === undefined ? {} : { message: withoutMisplaced(original.message) }),
    ...(original.pr === undefined ? {} : { pr: { ...original.pr, body: withoutMisplaced(original.pr.body) } }),
    replies: original.replies.map((reply) => ({ ...reply, body: withoutMisplaced(reply.body) })),
  };
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
