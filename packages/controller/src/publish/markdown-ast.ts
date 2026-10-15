import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { SKIP, visit } from "unist-util-visit";

/** A half-open range of source offsets. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export function parseMarkdown(body: string): Root {
  return fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

function rangeOf(node: Nodes): SourceRange | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/**
 * Source ranges of plain prose (text nodes), outside code blocks, inline code, HTML and
 * autolinks — and outside block quotes when `skipQuotes` is set. Ranges point into the original
 * string, so callers can edit the source without re-serialising (formatting is preserved).
 */
export function proseRanges(body: string, options: { readonly skipQuotes?: boolean } = {}): SourceRange[] {
  const ranges: SourceRange[] = [];
  visit(parseMarkdown(body), (node) => {
    if (options.skipQuotes === true && node.type === "blockquote") return SKIP;
    if (node.type === "text") {
      const range = rangeOf(node);
      if (range !== undefined) ranges.push(range);
    }
    return undefined;
  });
  return ranges;
}

/** Source ranges of raw HTML (comments included). */
export function htmlRanges(body: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  visit(parseMarkdown(body), "html", (node) => {
    const range = rangeOf(node);
    if (range !== undefined) ranges.push(range);
  });
  return ranges;
}

/** Applies non-overlapping edits to `body`, back to front so earlier offsets stay valid. */
export function applyEdits(body: string, edits: readonly (SourceRange & { readonly text: string })[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), body);
}
